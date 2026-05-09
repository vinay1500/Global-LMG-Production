import type { AdminActor } from '../auth/service.js';
import {
  buildPaginationMeta,
  countEvents,
  fetchClientsForList,
  fetchEvents,
  fetchMatters,
  normalizePagination,
} from '../shared.js';
import {
  createAuditEvent,
  createClientNotifications,
  resolveClientAccountByPublicId,
  resolveMatterByPublicId,
  touchMatterActivity,
} from '../writeSupport.js';
import { createPublicId } from '../../lib/authCrypto.js';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import { env } from '../../config/env.js';
import type { RowDataPacket } from 'mysql2/promise';
import { getActiveReminderSettings } from '../settings/notificationSettings.js';
import {
  getPlatformDefaultTimezone,
  isAllowedPlatformTimezone,
} from '../settings/platformSettings.js';
import { isGoogleCalendarConfigured, syncGoogleCalendarEvent } from './googleCalendarClient.js';

type EventStateRow = RowDataPacket & {
  cancelledAt: string | null;
  calendarOwnerEmail: string | null;
  calendarOwnerUserId: number | null;
  calendarSyncErrorText: string | null;
  calendarSyncStatusCode: string;
  clientEmail: string | null;
  clientAccountId: number;
  clientInviteModeCode: string;
  createdByUserId: number;
  durationMinutes: number;
  eventTypeCode: string;
  externalMeetingId: string | null;
  googleAttendeeStatusCode: string;
  id: number;
  joinUrl: string | null;
  locationText: string | null;
  matterClientAccountId: number | null;
  matterId: number | null;
  meetConferenceId: string | null;
  meetingProviderCode: string;
  modeCode: string;
  notes: string | null;
  publicId: string;
  scheduledEndAt: string;
  scheduledStartAt: string;
  statusCode: string;
  timezoneName: string;
  title: string;
  visibleToClient: number;
};

type CalendarSyncEventRow = EventStateRow & {
  clientName: string;
  matterTitle: string | null;
  organizerEmail: string | null;
};

type ClientRecipientRow = RowDataPacket & { id: number };
type ExistingEventRow = RowDataPacket & { id: number; publicId: string };

const pad = (value: number) => String(value).padStart(2, '0');

const formatMysqlDateTime = (value: Date) =>
  `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(
    value.getHours()
  )}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;

const toMysqlDateTime = (date: string, time: string) => `${date} ${time}:00`;

const addMinutes = (date: string, time: string, minutes: number) => {
  const base = new Date(`${date}T${time}:00`);
  const end = new Date(base.getTime() + minutes * 60 * 1000);
  return formatMysqlDateTime(end);
};

const datePart = (value: string) => String(value).slice(0, 10);
const timePart = (value: string) => String(value).slice(11, 16);

const addMinutesToMysqlDateTime = (dateTime: string, minutes: number) => {
  const base = new Date(`${dateTime.replace(' ', 'T')}`);
  return formatMysqlDateTime(new Date(base.getTime() + minutes * 60 * 1000));
};

const subtractMinutesFromMysqlDateTime = (dateTime: string, minutes: number) => {
  const base = new Date(`${dateTime.replace(' ', 'T')}`);
  return formatMysqlDateTime(new Date(base.getTime() - minutes * 60 * 1000));
};

const isFutureMysqlDateTime = (dateTime: string) =>
  new Date(`${dateTime.replace(' ', 'T')}`).getTime() > Date.now();

export const assertEventMatterBelongsToClient = (input: {
  clientAccountId: number;
  matterClientAccountId: number | null;
}) => {
  if (
    input.matterClientAccountId === null ||
    Number(input.clientAccountId) !== Number(input.matterClientAccountId)
  ) {
    throw badRequest(
      'event_client_matter_mismatch',
      'The selected matter does not belong to the selected client.'
    );
  }
};

const resolveEventTimezoneName = async (
  timezone: string | undefined,
  executor: QueryExecutor
) => {
  if (timezone) {
    if (!isAllowedPlatformTimezone(timezone)) {
      throw badRequest('invalid_timezone', 'Timezone must be one of the supported platform timezones.');
    }

    return timezone;
  }

  return getPlatformDefaultTimezone(executor);
};

const resolveEventByPublicId = async (eventPublicId: string, executor: QueryExecutor) => {
  const rows = await queryRows<EventStateRow>(
    `SELECT
       e.id,
       e.public_id AS publicId,
       e.client_account_id AS clientAccountId,
       e.matter_id AS matterId,
       e.title,
       e.event_type_code AS eventTypeCode,
       e.status_code AS statusCode,
       e.scheduled_start_at AS scheduledStartAt,
       e.scheduled_end_at AS scheduledEndAt,
       TIMESTAMPDIFF(MINUTE, e.scheduled_start_at, e.scheduled_end_at) AS durationMinutes,
       e.timezone_name AS timezoneName,
       e.mode_code AS modeCode,
       e.location_text AS locationText,
       e.meeting_provider_code AS meetingProviderCode,
       e.external_meeting_id AS externalMeetingId,
       e.join_url AS joinUrl,
       matter.client_account_id AS matterClientAccountId,
       COALESCE(e.calendar_sync_status_code, 'local') AS calendarSyncStatusCode,
       e.calendar_sync_error_text AS calendarSyncErrorText,
       e.meet_conference_id AS meetConferenceId,
       e.calendar_owner_user_id AS calendarOwnerUserId,
       e.calendar_owner_email AS calendarOwnerEmail,
       e.client_invite_mode_code AS clientInviteModeCode,
       e.google_attendee_status_code AS googleAttendeeStatusCode,
       e.client_visible_flag AS visibleToClient,
       e.notes,
       e.created_by_user_id AS createdByUserId,
       e.cancelled_at AS cancelledAt
     FROM events e
     LEFT JOIN matters matter ON matter.id = e.matter_id
     WHERE e.public_id = ?
     LIMIT 1
     FOR UPDATE`,
    [eventPublicId],
    executor
  );

  const event = rows[0];

  if (!event) {
    throw notFound('event_not_found', 'Event not found.');
  }

  return event;
};

const getClientRecipientUserIds = async (executor: QueryExecutor, clientAccountId: number) => {
  const rows = await queryRows<ClientRecipientRow>(
    `SELECT DISTINCT user_id AS id
     FROM client_account_contacts
     WHERE client_account_id = ?
       AND portal_access_enabled = 1
       AND archived_at IS NULL`,
    [clientAccountId],
    executor
  );

  return rows.map((row) => Number(row.id));
};

const cancelPendingReminders = async (
  executor: QueryExecutor,
  actor: AdminActor,
  eventId: number,
  reason: string
) => {
  const result = await executeStatement(
    `UPDATE event_reminders
     SET delivery_status_code = 'cancelled',
         failure_reason = ?,
         next_attempt_at = NULL,
         locked_at = NULL,
         locked_by = NULL,
         processed_at = UTC_TIMESTAMP(6)
     WHERE event_id = ?
       AND sent_at IS NULL
       AND delivery_status_code IN ('pending', 'failed', 'processing')`,
    [reason, eventId],
    executor
  );

  if (result.affectedRows > 0) {
    await createAuditEvent(
      {
        actionCode: 'event.reminder_cancelled',
        actionLabel: 'Event reminders cancelled',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [{ fieldName: 'pending_reminders', newValue: 'cancelled' }],
        entityPk: eventId,
        entityTableName: 'events',
        sourceModule: 'meetings_workspace',
        summaryNewValue: reason,
      },
      executor
    );
  }
};

const scheduleEventReminders = async (
  executor: QueryExecutor,
  actor: AdminActor,
  input: {
    clientAccountId: number;
    eventTypeCode: string;
    eventId: number;
    scheduledStartAt: string;
    visibleToClient: boolean;
  }
) => {
  await cancelPendingReminders(executor, actor, input.eventId, 'Event reminder schedule refreshed.');

  if (!input.visibleToClient) {
    return;
  }

  const recipientUserIds = await getClientRecipientUserIds(executor, input.clientAccountId);
  const reminderSettings = await getActiveReminderSettings(input.eventTypeCode, executor);
  let scheduledCount = 0;

  for (const recipientUserId of recipientUserIds) {
    for (const reminderSetting of reminderSettings) {
      const scheduledAt = subtractMinutesFromMysqlDateTime(input.scheduledStartAt, reminderSetting.offsetMinutes);

      if (!isFutureMysqlDateTime(scheduledAt)) {
        continue;
      }

      await executeStatement(
        `INSERT INTO event_reminders (
           event_id,
           recipient_user_id,
           channel_code,
           scheduled_at,
           sent_at,
           delivery_status_code,
           failure_reason
         ) VALUES (?, ?, ?, ?, NULL, 'pending', NULL)`,
        [input.eventId, recipientUserId, reminderSetting.channelCode, scheduledAt],
        executor
      );
      scheduledCount += 1;
    }
  }

  if (scheduledCount > 0) {
    await createAuditEvent(
      {
        actionCode: 'event.reminder_scheduled',
        actionLabel: 'Event reminders scheduled',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [{ fieldName: 'reminder_count', newValue: scheduledCount }],
        entityPk: input.eventId,
        entityTableName: 'events',
        sourceModule: 'meetings_workspace',
        summaryNewValue: `${scheduledCount} pending reminder(s)`,
      },
      executor
    );
  }
};

const resolveEventForCalendarSync = async (eventPublicId: string) => {
  const rows = await queryRows<CalendarSyncEventRow>(
    `SELECT
       e.id,
       e.public_id AS publicId,
       e.client_account_id AS clientAccountId,
       e.matter_id AS matterId,
       e.title,
       e.event_type_code AS eventTypeCode,
       e.status_code AS statusCode,
       e.scheduled_start_at AS scheduledStartAt,
       e.scheduled_end_at AS scheduledEndAt,
       TIMESTAMPDIFF(MINUTE, e.scheduled_start_at, e.scheduled_end_at) AS durationMinutes,
       e.timezone_name AS timezoneName,
       e.mode_code AS modeCode,
       e.location_text AS locationText,
       e.meeting_provider_code AS meetingProviderCode,
       e.external_meeting_id AS externalMeetingId,
       e.join_url AS joinUrl,
       COALESCE(e.calendar_sync_status_code, 'local') AS calendarSyncStatusCode,
       e.calendar_sync_error_text AS calendarSyncErrorText,
       e.meet_conference_id AS meetConferenceId,
       COALESCE(e.calendar_owner_user_id, e.created_by_user_id) AS calendarOwnerUserId,
       COALESCE(e.calendar_owner_email, organizer.email) AS calendarOwnerEmail,
       COALESCE(e.client_invite_mode_code, 'google_attendee') AS clientInviteModeCode,
       COALESCE(e.google_attendee_status_code, 'not_applicable') AS googleAttendeeStatusCode,
       e.client_visible_flag AS visibleToClient,
       e.notes,
       e.cancelled_at AS cancelledAt,
       e.created_by_user_id AS createdByUserId,
       ca.primary_email AS clientEmail,
       ca.display_name AS clientName,
       m.title AS matterTitle,
       organizer.email AS organizerEmail
     FROM events e
     JOIN client_accounts ca ON ca.id = e.client_account_id
     JOIN users organizer ON organizer.id = COALESCE(e.calendar_owner_user_id, e.created_by_user_id)
     LEFT JOIN matters m ON m.id = e.matter_id
     WHERE e.public_id = ?
     LIMIT 1`,
    [eventPublicId]
  );

  const event = rows[0];

  if (!event) {
    throw notFound('event_not_found', 'Event not found.');
  }

  return event;
};

const getClientInviteMode = () =>
  env.CALENDAR_CLIENT_INVITE_MODE === 'google_attendee' ? 'google_attendee' : 'none';

const hasGoogleAttendee = (event: CalendarSyncEventRow) =>
  getClientInviteMode() === 'google_attendee' && Boolean(event.clientEmail);

const markCalendarLocal = async (event: CalendarSyncEventRow) => {
  await executeStatement(
    `UPDATE events
     SET meeting_provider_code = CASE
           WHEN meeting_provider_code IN ('google-calendar-failed', 'google-calendar') THEN 'manual'
           ELSE meeting_provider_code
         END,
         calendar_sync_status_code = 'local',
         calendar_sync_error_text = NULL,
         calendar_synced_at = NULL,
         calendar_owner_user_id = ?,
         calendar_owner_email = ?,
         client_invite_mode_code = ?,
         google_attendee_status_code = 'not_applicable'
     WHERE id = ?`,
    [
      event.calendarOwnerUserId || event.createdByUserId,
      event.calendarOwnerEmail || event.organizerEmail,
      getClientInviteMode(),
      event.id,
    ]
  );
};

const auditCalendarSyncRequest = async (
  actor: AdminActor,
  eventId: number,
  lifecycleAction: 'create' | 'update' | 'cancel' | 'retry'
) => {
  await createAuditEvent({
    actionCode:
      lifecycleAction === 'retry'
        ? 'event.calendar_sync_retried'
        : 'event.calendar_sync_requested',
    actionLabel:
      lifecycleAction === 'retry' ? 'Calendar sync retried' : 'Calendar sync requested',
    actorRoleCode: actor.roleCodes[0] || 'ops_admin',
    actorUserId: actor.userId,
    changes: [{ fieldName: 'calendar_action', newValue: lifecycleAction }],
    entityPk: eventId,
    entityTableName: 'events',
    sourceModule: 'meetings_workspace',
    summaryNewValue: `Google Calendar sync ${lifecycleAction}.`,
  });
};

const syncCalendarForEvent = async (
  actor: AdminActor,
  eventPublicId: string,
  lifecycleAction: 'create' | 'update' | 'cancel' | 'retry'
) => {
  const event = await resolveEventForCalendarSync(eventPublicId);

  if (env.CALENDAR_SYNC_MODE !== 'google' || !isGoogleCalendarConfigured()) {
    if (lifecycleAction === 'retry') {
      await auditCalendarSyncRequest(actor, event.id, lifecycleAction);
    }
    await markCalendarLocal(event);
    return { eventId: event.publicId, status: 'local' as const };
  }

  await auditCalendarSyncRequest(actor, event.id, lifecycleAction);
  await executeStatement(
    `UPDATE events
     SET meeting_provider_code = 'google-calendar',
         calendar_sync_status_code = 'pending',
         calendar_sync_error_text = NULL,
         calendar_owner_user_id = ?,
         calendar_owner_email = ?,
         client_invite_mode_code = ?,
         google_attendee_status_code = CASE WHEN ? THEN 'pending' ELSE 'not_applicable' END
     WHERE id = ?`,
    [
      event.calendarOwnerUserId || event.createdByUserId,
      event.calendarOwnerEmail || event.organizerEmail,
      getClientInviteMode(),
      hasGoogleAttendee(event) ? 1 : 0,
      event.id,
    ]
  );

  const syncResult = await syncGoogleCalendarEvent(event);

  if (syncResult.status === 'synced') {
    const nextSyncStatus = lifecycleAction === 'cancel' ? 'cancelled' : 'synced';
    const nextAttendeeStatus = hasGoogleAttendee(event)
      ? lifecycleAction === 'cancel'
        ? 'cancelled'
        : 'invited'
      : 'not_applicable';

    await executeStatement(
      `UPDATE events
       SET meeting_provider_code = ?,
           external_meeting_id = ?,
           join_url = ?,
           calendar_sync_status_code = ?,
           calendar_sync_error_text = NULL,
           calendar_synced_at = UTC_TIMESTAMP(6),
           meet_conference_id = ?,
           calendar_owner_user_id = ?,
           calendar_owner_email = ?,
           client_invite_mode_code = ?,
           google_attendee_status_code = ?
       WHERE id = ?`,
      [
        syncResult.providerCode,
        syncResult.externalEventId,
        syncResult.joinUrl,
        nextSyncStatus,
        syncResult.conferenceId,
        event.calendarOwnerUserId || event.createdByUserId,
        event.calendarOwnerEmail || event.organizerEmail,
        getClientInviteMode(),
        nextAttendeeStatus,
        event.id,
      ]
    );

    await createAuditEvent({
      actionCode: 'event.calendar_sync_succeeded',
      actionLabel: 'Calendar sync succeeded',
      actorRoleCode: actor.roleCodes[0] || 'ops_admin',
      actorUserId: actor.userId,
      changes: [
        { fieldName: 'calendar_sync_status', oldValue: event.calendarSyncStatusCode, newValue: nextSyncStatus },
        { fieldName: 'external_meeting_id', oldValue: event.externalMeetingId, newValue: syncResult.externalEventId },
        { fieldName: 'calendar_owner_email', oldValue: event.calendarOwnerEmail, newValue: event.calendarOwnerEmail || event.organizerEmail },
      ],
      entityPk: event.id,
      entityTableName: 'events',
      sourceModule: 'meetings_workspace',
      summaryNewValue: syncResult.externalEventId,
    });

    if (hasGoogleAttendee(event)) {
      await createAuditEvent({
        actionCode: 'event.google_attendee_invited',
        actionLabel: 'Google attendee invite requested',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [{ fieldName: 'google_attendee_status_code', newValue: nextAttendeeStatus }],
        entityPk: event.id,
        entityTableName: 'events',
        sourceModule: 'meetings_workspace',
        summaryNewValue: event.clientEmail,
      });
    }

    return { eventId: event.publicId, status: nextSyncStatus };
  }

  await executeStatement(
    `UPDATE events
     SET meeting_provider_code = ?,
         calendar_sync_status_code = 'failed',
         calendar_sync_error_text = ?,
         calendar_synced_at = NULL,
         calendar_owner_user_id = ?,
         calendar_owner_email = ?,
         client_invite_mode_code = ?,
         google_attendee_status_code = CASE WHEN ? THEN 'failed' ELSE 'not_applicable' END
     WHERE id = ?`,
    [
      syncResult.providerCode,
      syncResult.errorText,
      event.calendarOwnerUserId || event.createdByUserId,
      event.calendarOwnerEmail || event.organizerEmail,
      getClientInviteMode(),
      hasGoogleAttendee(event) ? 1 : 0,
      event.id,
    ]
  );

  await createAuditEvent({
    actionCode: 'event.calendar_sync_failed',
    actionLabel: 'Calendar sync failed',
    actorRoleCode: actor.roleCodes[0] || 'ops_admin',
    actorUserId: actor.userId,
    changes: [
      { fieldName: 'calendar_sync_status', oldValue: event.calendarSyncStatusCode, newValue: 'failed' },
      { fieldName: 'calendar_sync_error_text', newValue: syncResult.errorText },
    ],
    entityPk: event.id,
    entityTableName: 'events',
    sourceModule: 'meetings_workspace',
    summaryNewValue: syncResult.errorText,
  });

  if (hasGoogleAttendee(event)) {
    await createAuditEvent({
      actionCode: 'event.google_attendee_invite_failed',
      actionLabel: 'Google attendee invite failed',
      actorRoleCode: actor.roleCodes[0] || 'ops_admin',
      actorUserId: actor.userId,
      changes: [{ fieldName: 'google_attendee_status_code', newValue: 'failed' }],
      entityPk: event.id,
      entityTableName: 'events',
      sourceModule: 'meetings_workspace',
      summaryNewValue: event.clientEmail,
    });
  }

  return { eventId: event.publicId, status: 'failed' as const };
};

export const getWorkspace = async (options: { limit?: number; offset?: number } = {}) => {
  const pagination = normalizePagination(options);
  const [clientsResponse, events, matters, total] = await Promise.all([
    fetchClientsForList({ limit: 100, offset: 0 }),
    fetchEvents({ includeCancelled: true, limit: pagination.limit, offset: pagination.offset }),
    fetchMatters({ limit: 100 }),
    countEvents({ includeCancelled: true }),
  ]);

  return {
    clients: clientsResponse,
    events,
    matters,
    pagination: buildPaginationMeta(pagination, total),
  };
};

export const createEvent = async (
  actor: AdminActor,
  payload: {
    clientAccountId?: string;
    date: string;
    durationMinutes?: number;
    matterId?: string;
    meetLink?: string;
    mode: string;
    notes?: string;
    time: string;
    timezone?: string;
    title: string;
    type: string;
    visibleToClient?: boolean;
  }
) => {
  const result = await withTransaction(async (connection) => {
    const matter = payload.matterId
      ? await resolveMatterByPublicId(payload.matterId, connection)
      : null;
    const explicitClientAccount = payload.clientAccountId
      ? await resolveClientAccountByPublicId(payload.clientAccountId, connection)
      : null;
    const clientAccount = explicitClientAccount || (matter ? { id: matter.clientAccountId } : null);

    if (!clientAccount) {
      throw badRequest(
        'event_context_required',
        'Either matterId or clientAccountId is required to create an event.'
      );
    }

    if (matter) {
      assertEventMatterBelongsToClient({
        clientAccountId: clientAccount.id,
        matterClientAccountId: matter.clientAccountId,
      });
    }

    const scheduledStartAt = toMysqlDateTime(payload.date, payload.time);
    const scheduledEndAt = addMinutes(
      payload.date,
      payload.time,
      Math.max(payload.durationMinutes || 60, 15)
    );
    const timezoneName = await resolveEventTimezoneName(payload.timezone, connection);
    const visibleToClient = payload.visibleToClient !== false;
    const existingRows = await queryRows<ExistingEventRow>(
      `SELECT id, public_id AS publicId
       FROM events
       WHERE client_account_id = ?
         AND matter_id <=> ?
         AND title = ?
         AND scheduled_start_at = ?
         AND timezone_name = ?
         AND cancelled_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [clientAccount.id, matter?.id || null, payload.title, scheduledStartAt, timezoneName],
      connection
    );

    if (existingRows[0]) {
      return { eventId: existingRows[0].publicId, status: 'created' as const };
    }

    const result = await executeStatement(
      `INSERT INTO events (
         public_id,
         client_account_id,
         matter_id,
         title,
         event_type_code,
         status_code,
         scheduled_start_at,
         scheduled_end_at,
         timezone_name,
         mode_code,
         location_text,
         meeting_provider_code,
         external_meeting_id,
         join_url,
         host_url,
         client_visible_flag,
         notes,
         created_by_user_id,
         cancelled_by_user_id,
         created_at,
         updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL,
         UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
       )`,
      [
        createPublicId(),
        clientAccount.id,
        matter?.id || null,
        payload.title,
        payload.type,
        scheduledStartAt,
        scheduledEndAt,
        timezoneName,
        payload.mode,
        payload.mode === 'video' ? 'Video Conference' : null,
        'manual',
        payload.meetLink || null,
        visibleToClient ? 1 : 0,
        payload.notes || null,
        actor.userId,
      ],
      connection
    );
    const eventId = Number(result.insertId);

    await scheduleEventReminders(connection, actor, {
      clientAccountId: clientAccount.id,
      eventTypeCode: payload.type,
      eventId,
      scheduledStartAt,
      visibleToClient,
    });

    if (matter) {
      await touchMatterActivity(matter.id, connection);
    }

    await createAuditEvent(
      {
        actionCode: 'event.created',
        actionLabel: 'Event created',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'title', newValue: payload.title },
          { fieldName: 'type', newValue: payload.type },
          { fieldName: 'scheduled_start_at', newValue: scheduledStartAt },
          { fieldName: 'timezone_name', newValue: timezoneName },
        ],
        entityPk: eventId,
        entityTableName: 'events',
        sourceModule: 'meetings_workspace',
        summaryNewValue: `${payload.title} on ${payload.date} ${payload.time}`,
      },
      connection
    );

    if (visibleToClient) {
      await createClientNotifications(
        {
          bodyText: `A new event has been scheduled for ${payload.date} at ${payload.time}.`,
          clientAccountId: clientAccount.id,
          eventId,
          matterId: matter?.id || null,
          notificationTypeCode: 'event_reminder',
          priorityCode: 'normal',
          title: payload.title,
        },
        connection
      );
    }

    const eventPublicRow = await queryRows<ExistingEventRow>(
      'SELECT public_id AS publicId, id FROM events WHERE id = ? LIMIT 1',
      [eventId],
      connection
    );

    return { eventId: eventPublicRow[0]?.publicId || '', status: 'created' as const };
  });

  if (result.eventId) {
    await syncCalendarForEvent(actor, result.eventId, 'create');
  }

  return result;
};

export const updateEvent = async (
  actor: AdminActor,
  eventPublicId: string,
  payload: {
    clientAccountId?: string;
    date?: string;
    durationMinutes?: number;
    matterId?: string | null;
    meetLink?: string | null;
    mode?: string;
    notes?: string | null;
    time?: string;
    timezone?: string;
    title?: string;
    type?: string;
    visibleToClient?: boolean;
  }
) => {
  const result = await withTransaction(async (connection) => {
    const event = await resolveEventByPublicId(eventPublicId, connection);

    if (event.cancelledAt || event.statusCode === 'cancelled') {
      throw badRequest('event_cancelled', 'Cancelled events cannot be updated.');
    }

    const matter =
      payload.matterId === undefined
        ? null
        : payload.matterId
          ? await resolveMatterByPublicId(payload.matterId, connection)
          : null;
    const clientAccount =
      matter
        ? { id: matter.clientAccountId }
        : payload.clientAccountId
          ? await resolveClientAccountByPublicId(payload.clientAccountId, connection)
          : { id: event.clientAccountId };
    const nextMatterId =
      payload.matterId === undefined ? event.matterId : matter ? matter.id : null;
    const nextMatterClientAccountId =
      payload.matterId === undefined ? event.matterClientAccountId : matter?.clientAccountId ?? null;

    if (nextMatterId) {
      assertEventMatterBelongsToClient({
        clientAccountId: clientAccount.id,
        matterClientAccountId: nextMatterClientAccountId,
      });
    }

    const nextDate = payload.date || datePart(event.scheduledStartAt);
    const nextTime = payload.time || timePart(event.scheduledStartAt);
    const nextStartAt = toMysqlDateTime(nextDate, nextTime);
    const nextDuration = Math.max(payload.durationMinutes || event.durationMinutes || 60, 15);
    const nextEndAt = addMinutesToMysqlDateTime(nextStartAt, nextDuration);
    const nextTimezoneName = await resolveEventTimezoneName(payload.timezone, connection);
    const nextMode = payload.mode || event.modeCode;
    const shouldClearJoinUrl = nextMode !== 'video';
    const hasMeetLinkPatch = Object.prototype.hasOwnProperty.call(payload, 'meetLink');
    const nextJoinUrl = shouldClearJoinUrl
      ? null
      : hasMeetLinkPatch
        ? payload.meetLink || null
        : event.joinUrl;
    const nextVisibleToClient =
      payload.visibleToClient === undefined
        ? Boolean(event.visibleToClient)
        : payload.visibleToClient;

    await executeStatement(
      `UPDATE events
       SET client_account_id = ?,
           matter_id = ?,
           title = ?,
           event_type_code = ?,
           scheduled_start_at = ?,
           scheduled_end_at = ?,
           timezone_name = ?,
           mode_code = ?,
           location_text = ?,
           join_url = ?,
           client_visible_flag = ?,
           notes = ?,
           status_code = CASE WHEN status_code = 'rescheduled' THEN 'rescheduled' ELSE status_code END,
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [
        clientAccount.id,
        nextMatterId,
        payload.title || event.title,
        payload.type || event.eventTypeCode,
        nextStartAt,
        nextEndAt,
        nextTimezoneName,
        nextMode,
        nextMode === 'video' ? 'Video Conference' : null,
        nextJoinUrl,
        nextVisibleToClient ? 1 : 0,
        payload.notes === undefined ? event.notes : payload.notes || null,
        event.id,
      ],
      connection
    );

    await scheduleEventReminders(connection, actor, {
      clientAccountId: clientAccount.id,
      eventTypeCode: payload.type || event.eventTypeCode,
      eventId: event.id,
      scheduledStartAt: nextStartAt,
      visibleToClient: nextVisibleToClient,
    });

    if (nextMatterId) {
      await touchMatterActivity(nextMatterId, connection);
    }

    await createAuditEvent(
      {
        actionCode: 'event.updated',
        actionLabel: 'Event updated',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'title', oldValue: event.title, newValue: payload.title || event.title },
          {
            fieldName: 'scheduled_start_at',
            oldValue: event.scheduledStartAt,
            newValue: nextStartAt,
          },
          {
            fieldName: 'timezone_name',
            oldValue: event.timezoneName,
            newValue: nextTimezoneName,
          },
          {
            fieldName: 'client_visible_flag',
            oldValue: Boolean(event.visibleToClient),
            newValue: nextVisibleToClient,
          },
        ],
        entityPk: event.id,
        entityTableName: 'events',
        sourceModule: 'meetings_workspace',
        summaryNewValue: `${payload.title || event.title} on ${nextDate} ${nextTime}`,
        summaryOldValue: `${event.title} on ${datePart(event.scheduledStartAt)} ${timePart(event.scheduledStartAt)}`,
      },
      connection
    );

    if (nextVisibleToClient) {
      await createClientNotifications(
        {
          bodyText: `Event updated for ${nextDate} at ${nextTime}.`,
          clientAccountId: clientAccount.id,
          eventId: event.id,
          matterId: nextMatterId,
          notificationTypeCode: 'event_reminder',
          priorityCode: 'normal',
          title: payload.title || event.title,
        },
        connection
      );
    }

    return { eventId: event.publicId, status: 'updated' as const };
  });

  await syncCalendarForEvent(actor, result.eventId, 'update');

  return result;
};

export const cancelEvent = async (
  actor: AdminActor,
  eventPublicId: string,
  payload: { reason?: string }
) => {
  const result = await withTransaction(async (connection) => {
    const event = await resolveEventByPublicId(eventPublicId, connection);

    if (event.cancelledAt || event.statusCode === 'cancelled') {
      return { eventId: event.publicId, status: 'cancelled' as const };
    }

    await executeStatement(
      `UPDATE events
       SET status_code = 'cancelled',
           cancelled_by_user_id = ?,
           cancelled_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [actor.userId, event.id],
      connection
    );

    await cancelPendingReminders(connection, actor, event.id, 'Event cancelled.');

    if (event.matterId) {
      await touchMatterActivity(event.matterId, connection);
    }

    await createAuditEvent(
      {
        actionCode: 'event.cancelled',
        actionLabel: 'Event cancelled',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'status_code', oldValue: event.statusCode, newValue: 'cancelled' },
          { fieldName: 'reason', newValue: payload.reason || null },
        ],
        entityPk: event.id,
        entityTableName: 'events',
        sourceModule: 'meetings_workspace',
        summaryNewValue: payload.reason || 'Event cancelled',
        summaryOldValue: event.statusCode,
      },
      connection
    );

    if (event.visibleToClient) {
      await createClientNotifications(
        {
          bodyText: payload.reason
            ? `The scheduled event was cancelled. Reason: ${payload.reason}`
            : 'The scheduled event was cancelled.',
          clientAccountId: event.clientAccountId,
          eventId: event.id,
          matterId: event.matterId,
          notificationTypeCode: 'event_reminder',
          priorityCode: 'normal',
          title: `${event.title} cancelled`,
        },
        connection
      );
    }

    return { eventId: event.publicId, status: 'cancelled' as const };
  });

  await syncCalendarForEvent(actor, result.eventId, 'cancel');

  return result;
};

export const retryEventCalendarSync = async (actor: AdminActor, eventPublicId: string) =>
  syncCalendarForEvent(actor, eventPublicId, 'retry');
