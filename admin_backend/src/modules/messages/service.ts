import type { AdminActor } from '../auth/service.js';
import { createPublicId } from '../../lib/authCrypto.js';
import { allocateBusinessNumber } from '../../lib/businessSequences.js';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { sanitizeMessageContent } from '../../lib/messageContent.js';
import { executeStatement, queryRows, withTransaction } from '../../lib/mysql.js';
import { logEvent } from '../../lib/observability.js';
import { env } from '../../config/env.js';
import type { RowDataPacket } from 'mysql2/promise';
import {
  buildPaginationMeta,
  countThreads,
  fetchClientOptions,
  fetchEvents,
  fetchInvoiceSummaries,
  fetchMatterOptions,
  fetchMessagesByThreadIds,
  fetchThreads,
  normalizePagination,
} from '../shared.js';
import {
  createAuditEvent,
  createClientNotifications,
  resolveThreadByPublicId,
  touchMatterActivity,
  touchThreadActivity,
} from '../writeSupport.js';

type ThreadStateRow = RowDataPacket & {
  archivedAt: string | null;
  closedAt: string | null;
  id: number;
  statusCode: string;
};

type ClientAccountRow = RowDataPacket & {
  displayName: string;
  id: number;
};

type ClientContactRow = RowDataPacket & {
  userId: number;
};

type MatterLookupRow = RowDataPacket & {
  clientAccountId: number;
  id: number;
  matterNumber: string;
  title: string;
};

type ExistingGeneralThreadRow = RowDataPacket & {
  id: number;
  publicId: string;
  subject: string | null;
};

export const getWorkspace = async (actor: AdminActor, options: { limit?: number; offset?: number } = {}) => {
  const startedAt = process.hrtime.bigint();
  const pagination = normalizePagination(options);
  const threads = await fetchThreads({
    limit: pagination.limit,
    offset: pagination.offset,
    viewerUserId: actor.userId,
  });
  if (threads.length === 0) {
    const clients = await fetchClientOptions({ limit: 250, offset: 0 });
    const matters = await fetchMatterOptions({ limit: 250 });
    const total = await countThreads({});
    if (env.APP_ENV !== 'production') {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logEvent('info', 'admin.messages_workspace.loaded', {
        durationMs: Number(durationMs.toFixed(2)),
        limit: pagination.limit,
        offset: pagination.offset,
        queryCountEstimate: 4,
        threadCount: 0,
      });
    }

    return {
      clients,
      events: [],
      invoices: [],
      matters,
      messages: [],
      pagination: buildPaginationMeta(pagination, total),
      threads: [],
    };
  }

  const clientIds = Array.from(new Set(threads.map((thread) => thread.clientId).filter(Boolean)));
  const clients = await fetchClientOptions({ limit: 250, offset: 0 });
  const allMatters = await fetchMatterOptions({ limit: 250 });
  const invoices = await fetchInvoiceSummaries({ clientAccountIds: clientIds, limit: 100 });
  const events = await fetchEvents({ clientAccountIds: clientIds });
  const messages = await fetchMessagesByThreadIds(threads.map((thread) => thread.id));
  const total = await countThreads({});
  const response = {
    clients,
    events,
    invoices,
    matters: allMatters,
    messages,
    pagination: buildPaginationMeta(pagination, total),
    threads,
  };

  if (env.APP_ENV !== 'production') {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logEvent('info', 'admin.messages_workspace.loaded', {
      clientCount: clients.length,
      durationMs: Number(durationMs.toFixed(2)),
      invoiceCount: invoices.length,
      limit: pagination.limit,
      messageCount: messages.length,
      offset: pagination.offset,
      queryCountEstimate: 7,
      threadCount: threads.length,
    });
  }

  return response;
};

export const createThread = async (
  actor: AdminActor,
  payload: {
    clientId: string;
    confirmDuplicateGeneral?: boolean;
    content: string;
    matterId?: string;
  }
) => {
  const messageContent = sanitizeMessageContent(payload.content);
  if (!messageContent) {
    throw badRequest('message_content_required', 'Message content is required.');
  }

  return withTransaction(async (connection) => {
    const clientRows = await queryRows<ClientAccountRow>(
      `SELECT id, display_name AS displayName
       FROM client_accounts
       WHERE public_id = ?
         AND archived_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [payload.clientId],
      connection
    );
    const client = clientRows[0];

    if (!client) {
      throw notFound('client_account_not_found', 'Client account not found.');
    }

    const contactRows = await queryRows<ClientContactRow>(
      `SELECT DISTINCT cac.user_id AS userId
       FROM client_account_contacts cac
       INNER JOIN users u ON u.id = cac.user_id
       WHERE cac.client_account_id = ?
         AND cac.archived_at IS NULL
         AND cac.portal_access_enabled = 1
         AND u.archived_at IS NULL
         AND u.login_enabled = 1`,
      [client.id],
      connection
    );

    if (contactRows.length === 0) {
      throw badRequest(
        'client_portal_unavailable',
        'This client does not have an active portal contact for messaging.'
      );
    }

    let matter: MatterLookupRow | null = null;

    if (payload.matterId) {
      const matterRows = await queryRows<MatterLookupRow>(
        `SELECT
           id,
           client_account_id AS clientAccountId,
           matter_number AS matterNumber,
           title
         FROM matters
         WHERE public_id = ?
           AND archived_at IS NULL
         LIMIT 1`,
        [payload.matterId],
        connection
      );
      matter = matterRows[0] || null;

      if (!matter) {
        throw notFound('matter_not_found', 'Matter not found.');
      }

      if (Number(matter.clientAccountId) !== Number(client.id)) {
        throw badRequest('matter_client_mismatch', 'Selected matter does not belong to this client.');
      }
    }

    if (!matter && !payload.confirmDuplicateGeneral) {
      const existingGeneralThreadRows = await queryRows<ExistingGeneralThreadRow>(
        `SELECT id, public_id AS publicId, subject
         FROM conversation_threads
         WHERE client_account_id = ?
           AND matter_id IS NULL
           AND thread_type_code = 'general'
           AND archived_at IS NULL
           AND closed_at IS NULL
           AND status_code IN ('active', 'waiting')
         ORDER BY updated_at DESC
         LIMIT 1
         FOR UPDATE`,
        [client.id],
        connection
      );
      const existingGeneralThread = existingGeneralThreadRows[0];

      if (existingGeneralThread) {
        throw badRequest(
          'active_general_thread_exists',
          'An active general thread already exists for this client.',
          {
            existingThreadId: existingGeneralThread.publicId,
            existingThreadSubject: existingGeneralThread.subject || 'General Support',
          }
        );
      }
    }

    const threadPublicId = createPublicId();
    const messagePublicId = createPublicId();
    const threadNumber = await allocateBusinessNumber(connection, 'thread', 'THR');
    const subject = matter ? matter.title : 'General Support';
    const threadType = matter ? 'matter' : 'general';

    const threadResult = await executeStatement(
      `INSERT INTO conversation_threads (
         public_id,
         thread_number,
         thread_type_code,
         client_account_id,
         matter_id,
         subject,
         status_code,
         created_by_user_id,
         assigned_owner_user_id,
         last_message_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        threadPublicId,
        threadNumber,
        threadType,
        client.id,
        matter?.id || null,
        subject,
        actor.userId,
        actor.userId,
      ],
      connection
    );
    const threadId = Number(threadResult.insertId);

    await executeStatement(
      `INSERT INTO thread_participants (
         thread_id,
         participant_role_code,
         internal_user_id,
         client_contact_user_id,
         counsel_partner_id,
         is_active,
         joined_at,
         left_at,
         last_read_message_id,
         last_read_at
       ) VALUES (?, 'staff', ?, NULL, NULL, 1, UTC_TIMESTAMP(6), NULL, NULL, NULL)`,
      [threadId, actor.userId],
      connection
    );

    for (const contact of contactRows) {
      await executeStatement(
        `INSERT INTO thread_participants (
           thread_id,
           participant_role_code,
           internal_user_id,
           client_contact_user_id,
           counsel_partner_id,
           is_active,
           joined_at,
           left_at,
           last_read_message_id,
           last_read_at
         ) VALUES (?, 'client', NULL, ?, NULL, 1, UTC_TIMESTAMP(6), NULL, NULL, NULL)`,
        [threadId, contact.userId],
        connection
      );
    }

    const messageResult = await executeStatement(
      `INSERT INTO messages (
         public_id,
         thread_id,
         sender_user_id,
         sender_counsel_partner_id,
         sender_system_code,
         message_type_code,
         body_text,
         visible_to_client,
         reply_to_message_id,
         sent_at,
         edited_at,
         deleted_at
       ) VALUES (?, ?, ?, NULL, NULL, 'text', ?, 1, NULL, UTC_TIMESTAMP(6), NULL, NULL)`,
      [messagePublicId, threadId, actor.userId, messageContent],
      connection
    );

    await executeStatement(
      `INSERT IGNORE INTO message_reads (message_id, user_id, read_at)
       VALUES (?, ?, UTC_TIMESTAMP(6))`,
      [messageResult.insertId, actor.userId],
      connection
    );

    await executeStatement(
      `UPDATE thread_participants
       SET last_read_at = UTC_TIMESTAMP(6),
           last_read_message_id = ?
       WHERE thread_id = ?
         AND internal_user_id = ?`,
      [messageResult.insertId, threadId, actor.userId],
      connection
    );

    await touchThreadActivity(threadId, connection);

    if (matter) {
      await touchMatterActivity(matter.id, connection);
    }

    await createAuditEvent(
      {
        actionCode: 'thread.created',
        actionLabel: 'Admin message thread created',
        actorRoleCode: actor.roleCodes[0] || 'messaging_desk',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'client_account_id', newValue: payload.clientId },
          { fieldName: 'matter_id', newValue: payload.matterId || null },
          { fieldName: 'body_text', newValue: messageContent },
        ],
        entityPk: threadId,
        entityTableName: 'conversation_threads',
        sourceModule: 'messages_workspace',
        summaryNewValue: `${subject}: ${messageContent.slice(0, 160)}`,
      },
      connection
    );

    await createClientNotifications(
      {
        bodyText: messageContent.slice(0, 240),
        clientAccountId: client.id,
        matterId: matter?.id || null,
        notificationTypeCode: 'message_received',
        priorityCode: 'normal',
        threadId,
        title: 'New message from Global LMG',
      },
      connection
    );

    return {
      messageId: messagePublicId,
      status: 'created' as const,
      threadId: threadPublicId,
      threadNumber,
    };
  });
};

export const replyToThread = async (
  actor: AdminActor,
  payload: {
    content: string;
    threadId: string;
    visibleToClient?: boolean;
  }
) => {
  const messageContent = sanitizeMessageContent(payload.content);
  if (!messageContent) {
    throw badRequest('message_content_required', 'Message content is required.');
  }

  return withTransaction(async (connection) => {
    const thread = await resolveThreadByPublicId(payload.threadId, connection);
    const stateRows = await queryRows<ThreadStateRow>(
      `SELECT
         id,
         status_code AS statusCode,
         closed_at AS closedAt,
         archived_at AS archivedAt
       FROM conversation_threads
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [thread.id],
      connection
    );
    const state = stateRows[0];

    if (!state || state.archivedAt) {
      throw notFound('thread_not_found', 'Message thread not found.');
    }

    if (state.closedAt || state.statusCode === 'resolved') {
      throw badRequest('thread_closed', 'Closed threads cannot receive replies.');
    }

    const messageResult = await executeStatement(
      `INSERT INTO messages (
         public_id,
         thread_id,
         sender_user_id,
         sender_counsel_partner_id,
         sender_system_code,
         message_type_code,
         body_text,
         visible_to_client,
         reply_to_message_id,
         sent_at,
         edited_at,
         deleted_at
       ) VALUES (?, ?, ?, NULL, NULL, 'text', ?, ?, NULL, UTC_TIMESTAMP(6), NULL, NULL)`,
      [
        createPublicId(),
        thread.id,
        actor.userId,
        messageContent,
        payload.visibleToClient === false ? 0 : 1,
      ],
      connection
    );

    await executeStatement(
      `INSERT IGNORE INTO message_reads (message_id, user_id, read_at)
       VALUES (?, ?, UTC_TIMESTAMP(6))`,
      [messageResult.insertId, actor.userId],
      connection
    );

    await executeStatement(
      `UPDATE conversation_threads
       SET status_code = 'active',
           assigned_owner_user_id = COALESCE(assigned_owner_user_id, ?),
           last_message_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [actor.userId, thread.id],
      connection
    );

    await touchThreadActivity(thread.id, connection);

    if (thread.matterId) {
      await touchMatterActivity(thread.matterId, connection);
    }

    await createAuditEvent(
      {
        actionCode: 'message.sent',
        actionLabel: 'Admin message sent',
        actorRoleCode: actor.roleCodes[0] || 'messaging_desk',
        actorUserId: actor.userId,
        changes: [{ fieldName: 'body_text', newValue: messageContent }],
        entityPk: thread.id,
        entityTableName: 'conversation_threads',
        sourceModule: 'messages_workspace',
        summaryNewValue: messageContent.slice(0, 180),
      },
      connection
    );

    if (payload.visibleToClient !== false) {
      await createClientNotifications(
        {
          bodyText: messageContent.slice(0, 240),
          clientAccountId: thread.clientAccountId,
          matterId: thread.matterId,
          notificationTypeCode: 'message_received',
          priorityCode: 'normal',
          threadId: thread.id,
          title: 'New message from Global LMG',
        },
        connection
      );
    }

    return {
      messageId: messageResult.insertId,
      status: 'created' as const,
    };
  });
};

export const markThreadRead = async (actor: AdminActor, threadPublicId: string) => {
  return withTransaction(async (connection) => {
    const thread = await resolveThreadByPublicId(threadPublicId, connection);

    await executeStatement(
      `INSERT IGNORE INTO message_reads (message_id, user_id, read_at)
       SELECT msg.id, ?, UTC_TIMESTAMP(6)
       FROM messages msg
       WHERE msg.thread_id = ?
         AND msg.deleted_at IS NULL
         AND (msg.sender_user_id IS NULL OR msg.sender_user_id <> ?)`,
      [actor.userId, thread.id, actor.userId],
      connection
    );

    await executeStatement(
      `UPDATE thread_participants
       SET last_read_at = UTC_TIMESTAMP(6),
           last_read_message_id = (
             SELECT MAX(msg.id)
             FROM messages msg
             WHERE msg.thread_id = ?
               AND msg.deleted_at IS NULL
           )
       WHERE thread_id = ?
         AND internal_user_id = ?`,
      [thread.id, thread.id, actor.userId],
      connection
    );

    await executeStatement(
      `UPDATE notifications
       SET is_read = 1,
           read_at = COALESCE(read_at, UTC_TIMESTAMP(6))
       WHERE thread_id = ?
         AND recipient_user_id = ?
         AND notification_type_code = 'message_received'
         AND is_read = 0`,
      [thread.id, actor.userId],
      connection
    );

    return { status: 'read' as const };
  });
};

export const archiveThread = async (actor: AdminActor, threadPublicId: string) => {
  return withTransaction(async (connection) => {
    const rows = await queryRows<ThreadStateRow>(
      `SELECT
         id,
         status_code AS statusCode,
         closed_at AS closedAt,
         archived_at AS archivedAt
       FROM conversation_threads
       WHERE public_id = ?
       LIMIT 1
       FOR UPDATE`,
      [threadPublicId],
      connection
    );
    const thread = rows[0];

    if (!thread) {
      throw notFound('thread_not_found', 'Message thread not found.');
    }

    if (thread.archivedAt) {
      return { status: 'archived' as const };
    }

    await executeStatement(
      `UPDATE conversation_threads
       SET status_code = 'resolved',
           closed_at = COALESCE(closed_at, UTC_TIMESTAMP(6)),
           archived_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [thread.id],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'thread.archived',
        actionLabel: 'Message thread archived',
        actorRoleCode: actor.roleCodes[0] || 'messaging_desk',
        actorUserId: actor.userId,
        changes: [
          {
            fieldName: 'status_code',
            newValue: 'resolved',
            oldValue: thread.statusCode,
          },
          {
            fieldName: 'archived_at',
            newValue: 'archived',
            oldValue: thread.archivedAt,
          },
        ],
        entityPk: thread.id,
        entityTableName: 'conversation_threads',
        sourceModule: 'messages_workspace',
        summaryNewValue: 'Archived',
        summaryOldValue: thread.statusCode,
      },
      connection
    );

    return { status: 'archived' as const };
  });
};
