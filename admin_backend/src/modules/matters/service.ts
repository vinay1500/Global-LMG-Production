import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createPublicId } from '../../lib/authCrypto.js';
import { allocateBusinessNumber } from '../../lib/businessSequences.js';
import { badRequest, forbidden, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction } from '../../lib/mysql.js';
import {
  buildPaginationMeta,
  countMatters,
  fetchDocuments,
  fetchEvents,
  fetchInvoices,
  fetchMatters,
  fetchThreads,
  normalizePagination,
} from '../shared.js';
import type { AdminActor } from '../auth/service.js';
import {
  assertCanAccessMatter,
  getAssignedRecordScopeFilters,
  hasAdminPermission,
} from '../access/scope.js';
import {
  createAuditEvent,
  createClientNotifications,
  resolveClientAccountByPublicId,
  resolveCounselByPublicId,
  resolveInternalUserByPublicId,
  resolveMatterByPublicId,
  touchMatterActivity,
} from '../writeSupport.js';

export const listMatters = async (
  actor: AdminActor,
  options: { limit: number; offset?: number; search?: string }
) => {
  const pagination = normalizePagination(options);
  const scopeFilters = await getAssignedRecordScopeFilters(actor, {
    assignedPermission: 'matter.view_assigned',
    fullPermission: 'matter.view',
    includeClientAccounts: true,
    includeMatters: true,
  });
  const [createOptions, matters, total] = await Promise.all([
    getMatterCreateOptions({
      clientAccountDbIds: scopeFilters.clientAccountDbIds,
      hideClients: !hasAdminPermission(actor, 'matter.update'),
    }),
    fetchMatters({
      actor,
      limit: pagination.limit,
      matterDbIds: scopeFilters.matterDbIds,
      offset: pagination.offset,
      search: options.search,
    }),
    countMatters({
      matterDbIds: scopeFilters.matterDbIds,
      search: options.search,
    }),
  ]);

  return {
    createOptions,
    matters,
    pagination: buildPaginationMeta(pagination, total),
  };
};

type InternalUserRow = RowDataPacket & {
  city: string | null;
  country: string;
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
  specialization: string | null;
  state: string | null;
};
type CounselRow = RowDataPacket & {
  city: string | null;
  country: string | null;
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
  specialization: string | null;
  state: string | null;
  type: 'external_counsel' | 'field_partner';
};
type ClientOptionRow = RowDataPacket & { email: string; id: string; name: string };
type DomainOptionRow = RowDataPacket & { code: string; name: string };
type ServiceOptionRow = RowDataPacket & {
  code: string;
  name: string;
};
type StageOptionRow = RowDataPacket & { code: string; label: string };
type StatusOptionRow = RowDataPacket & { code: string; label: string };
type UrgencyOptionRow = RowDataPacket & { code: string; label: string };
type ConsultationModeOptionRow = RowDataPacket & { code: string; label: string };
type MatterClientMetaRow = RowDataPacket & {
  accountStatusCode: string;
  clientAccountId: number;
  clientName: string;
};
type LegalDomainRow = RowDataPacket & { id: number; name: string };
type ServiceIdRow = RowDataPacket & { id: number; serviceCode: string };
type UrgencyRuleRow = RowDataPacket & { id: number };
type MatterUpdateRow = RowDataPacket & {
  clientAccountId: number;
  currentStageCode: string;
  issueSummary: string;
  operationalStatusCode: string;
  paidAmount: number;
  priorityCode: string;
  quotedTotalAmount: number;
};

const CLOSED_MATTER_STATUSES = new Set(['archived', 'completed']);
const VALID_PRIORITY_CODES = new Set([
  'awaiting-client',
  'awaiting-team',
  'completed',
  'immediate-6h',
  'in-progress',
  'on-hold',
]);

const DEFAULT_MATTER_STAGE = 'request-received';
const DEFAULT_MATTER_STATUS = 'new-lead';
const DEFAULT_CONSULTATION_MODE = 'video';
const DEFAULT_URGENCY_CODE = 'standard';

const buildInClause = (values: readonly unknown[]) => values.map(() => '?').join(', ');

const firstRow = <TRow>(rows: TRow[]) => rows[0] || null;

const assertMatterStageCode = async (stageCode: string, executor: Parameters<typeof queryRows>[2]) => {
  const row = firstRow(
    await queryRows<RowDataPacket & { code: string }>(
      `SELECT code
       FROM matter_stages
       WHERE code = ?
       LIMIT 1`,
      [stageCode],
      executor
    )
  );

  if (!row) {
    throw badRequest('invalid_matter_stage', 'The requested matter stage is not configured.');
  }
};

const assertMatterStatusCode = async (statusCode: string, executor: Parameters<typeof queryRows>[2]) => {
  const row = firstRow(
    await queryRows<RowDataPacket & { code: string }>(
      `SELECT code
       FROM matter_operational_statuses
       WHERE code = ?
       LIMIT 1`,
      [statusCode],
      executor
    )
  );

  if (!row) {
    throw badRequest('invalid_matter_status', 'The requested matter status is not configured.');
  }
};

const assertMatterPriorityCode = (priorityCode: string) => {
  if (!VALID_PRIORITY_CODES.has(priorityCode)) {
    throw badRequest('invalid_matter_priority', 'The requested matter priority is not supported.');
  }
};

const assertMatterCanMutate = (
  meta: Pick<MatterUpdateRow, 'operationalStatusCode'>,
  nextStatusCode?: string
) => {
  if (
    CLOSED_MATTER_STATUSES.has(meta.operationalStatusCode) &&
    (!nextStatusCode || CLOSED_MATTER_STATUSES.has(nextStatusCode))
  ) {
    throw badRequest(
      'matter_closed',
      'This matter is closed. Reopen it before making lifecycle, assignment, note, or package changes.'
    );
  }
};

const getMatterCreateOptions = async (
  options: { clientAccountDbIds?: number[]; hideClients?: boolean } = {}
) => {
  const [clientRows, domainRows, serviceRows, stageRows, statusRows, urgencyRows, consultationModeRows] =
    await Promise.all([
      options.hideClients
        ? Promise.resolve<ClientOptionRow[]>([])
        : queryRows<ClientOptionRow>(
            `SELECT public_id AS id, display_name AS name, primary_email AS email
             FROM client_accounts
             WHERE archived_at IS NULL
               AND account_status_code = 'active'
               ${
                 options.clientAccountDbIds === undefined
                   ? ''
                   : options.clientAccountDbIds.length === 0
                     ? 'AND FALSE'
                     : `AND id IN (${buildInClause(options.clientAccountDbIds)})`
               }
             ORDER BY display_name ASC
             LIMIT 500`,
            options.clientAccountDbIds?.length ? options.clientAccountDbIds : []
          ),
      queryRows<DomainOptionRow>(
        `SELECT domain_code AS code, domain_name AS name
         FROM legal_domains
         WHERE is_active = 1
         ORDER BY sort_order ASC, domain_name ASC`
      ),
      queryRows<ServiceOptionRow>(
        `SELECT
           s.service_code AS code,
           s.service_name AS name
         FROM services s
         WHERE s.is_active = 1
         ORDER BY s.sort_order ASC, s.service_name ASC`
      ),
      queryRows<StageOptionRow>(
        `SELECT code, label
         FROM matter_stages
         WHERE is_active = 1
         ORDER BY stage_order ASC`
      ),
      queryRows<StatusOptionRow>(
        `SELECT code, label
         FROM matter_operational_statuses
         WHERE is_active = 1
         ORDER BY sort_order ASC`
      ),
      queryRows<UrgencyOptionRow>(
        `SELECT urgency_code AS code, label
         FROM pricing_urgency_rules
         WHERE is_active = 1
         ORDER BY sort_order ASC`
      ),
      queryRows<ConsultationModeOptionRow>(
        `SELECT code, label
         FROM consultation_modes
         WHERE is_active = 1
         ORDER BY sort_order ASC`
      ),
    ]);

  return {
    clients: clientRows,
    consultationModes: consultationModeRows,
    domains: domainRows,
    priorities: [
      { code: 'in-progress', label: 'In Progress' },
      { code: 'immediate-6h', label: 'Immediate' },
      { code: 'awaiting-client', label: 'Awaiting Client' },
      { code: 'awaiting-team', label: 'Awaiting Team' },
      { code: 'on-hold', label: 'On Hold' },
    ],
    services: serviceRows,
    stages: stageRows,
    statuses: statusRows,
    urgencyRules: urgencyRows,
  };
};

const getAssignmentOptions = async () => {
  const [staffRows, counselRows] = await Promise.all([
    queryRows<InternalUserRow>(
      `SELECT
         u.public_id AS id,
         u.display_name AS name,
         CASE WHEN u.email LIKE '%@staff.local.globallmg' THEN NULL ELSE u.email END AS email,
         u.phone,
         sp.job_title AS specialization,
         sp.city,
         sp.state,
         'IN' AS country
       FROM users u
       INNER JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE u.archived_at IS NULL
         AND u.actor_type_code <> 'client'
         AND sp.employment_status_code = 'active'
       ORDER BY u.display_name ASC`
    ),
    queryRows<CounselRow>(
      `SELECT
         public_id AS id,
         full_name AS name,
         email,
         phone,
         COALESCE(specialization_text, primary_jurisdiction) AS specialization,
         city,
         state,
         country_code AS country,
         COALESCE(partner_type_code, 'external_counsel') AS type
       FROM counsel_partners
       WHERE archived_at IS NULL
         AND partner_status_code = 'active'
       ORDER BY full_name ASC`
    ),
  ]);

  return {
    counsel: counselRows,
    staff: staffRows,
  };
};

const assertMatterMutationScope = async (
  actor: AdminActor,
  matterId: string,
  executor: Parameters<typeof queryRows>[2]
) => {
  if (!hasAdminPermission(actor, 'matter.update')) {
    await assertCanAccessMatter(actor, matterId, executor);
  }
};

const ASSIGNED_MATTER_DETAIL_UPDATE_FIELDS = new Set(['operationalStatusCode']);

const assertMatterDetailUpdateFields = (
  actor: AdminActor,
  payload: {
    issueSummary?: string;
    operationalStatusCode?: string;
    priorityCode?: string;
    quotedTotalAmount?: number;
    selectedServices?: string[];
  }
) => {
  if (hasAdminPermission(actor, 'matter.update')) {
    return;
  }

  const deniedFields = Object.keys(payload).filter((fieldName) => !ASSIGNED_MATTER_DETAIL_UPDATE_FIELDS.has(fieldName));
  if (deniedFields.length > 0) {
    throw forbidden(
      'matter_assigned_update_field_forbidden',
      'Assigned matter updates cannot change pricing, services, packages, assignments, or core matter details.'
    );
  }
};

export const getMatterWorkspace = async (actor: AdminActor, matterId: string) => {
  const hasFullMatterView = hasAdminPermission(actor, 'matter.view');
  if (!hasFullMatterView) {
    await assertCanAccessMatter(actor, matterId);
  }

  const matters = await fetchMatters({ actor, matterIds: [matterId] });
  const matter = matters[0];

  if (!matter) {
    throw notFound('matter_not_found', 'Matter not found.');
  }

  const canViewBilling = hasAdminPermission(actor, 'invoice.view');
  const canManageMatter = hasAdminPermission(actor, 'matter.update');

  return {
    assignmentOptions: canManageMatter ? await getAssignmentOptions() : { counsel: [], staff: [] },
    createOptions: await getMatterCreateOptions({ hideClients: !canManageMatter }),
    documents: await fetchDocuments({ actor, matterIds: [matterId] }),
    events: await fetchEvents({ actor, matterIds: [matterId] }),
    invoices: canViewBilling ? await fetchInvoices({ matterIds: [matterId] }) : [],
    matter,
    threads: await fetchThreads({ actor, matterIds: [matterId] }),
  };
};

export const createMatter = async (
  actor: AdminActor,
  payload: {
    clientAccountPublicId: string;
    clientVisible?: boolean;
    consultationModeCode?: string;
    legalDomainCode?: string;
    priorityCode?: string;
    serviceCode?: string;
    serviceCodes?: string[];
    stageCode?: string;
    statusCode?: string;
    summary?: string;
    title: string;
    urgencyCode?: string;
  }
) => {
  const matterPublicId = await withTransaction(async (connection) => {
    const clientAccount = await resolveClientAccountByPublicId(payload.clientAccountPublicId, connection);
    const clientMeta = firstRow(
      await queryRows<MatterClientMetaRow>(
        `SELECT
           id AS clientAccountId,
           display_name AS clientName,
           account_status_code AS accountStatusCode
         FROM client_accounts
         WHERE id = ?
           AND archived_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [clientAccount.id],
        connection
      )
    );

    if (!clientMeta) {
      throw notFound('client_account_not_found', 'Client account not found.');
    }

    if (clientMeta.accountStatusCode !== 'active') {
      throw badRequest(
        'client_not_active_for_matter',
        'This client account is not active enough for a new matter.'
      );
    }

    const selectedServiceCodes = Array.from(
      new Set(
        [payload.serviceCode, ...(payload.serviceCodes || [])]
          .map((code) => code?.trim())
          .filter((code): code is string => Boolean(code))
      )
    );

    const serviceRows = selectedServiceCodes.length
        ? await queryRows<ServiceIdRow>(
          `SELECT
           s.id,
           s.service_code AS serviceCode
           FROM services s
           WHERE s.service_code IN (${buildInClause(selectedServiceCodes)})
             AND s.is_active = 1`,
          selectedServiceCodes,
          connection
        )
      : [];

    if (serviceRows.length !== selectedServiceCodes.length) {
      throw badRequest('invalid_service_codes', 'One or more selected services are invalid.');
    }

    const legalDomainCode = payload.legalDomainCode || undefined;
    const legalDomain = legalDomainCode
      ? firstRow(
          await queryRows<LegalDomainRow>(
            `SELECT id, domain_name AS name
             FROM legal_domains
             WHERE domain_code = ?
               AND is_active = 1
             LIMIT 1`,
            [legalDomainCode],
            connection
          )
        )
      : firstRow(
          await queryRows<LegalDomainRow>(
            `SELECT id, domain_name AS name
             FROM legal_domains
             WHERE is_active = 1
             ORDER BY sort_order ASC, domain_name ASC
             LIMIT 1`,
            [],
            connection
          )
        );

    if (!legalDomain) {
      throw badRequest('invalid_legal_domain', 'Select a configured legal domain for this matter.');
    }

    const stageCode = payload.stageCode || DEFAULT_MATTER_STAGE;
    const statusCode = payload.statusCode || DEFAULT_MATTER_STATUS;
    const urgencyCode = payload.urgencyCode || DEFAULT_URGENCY_CODE;
    const consultationModeCode = payload.consultationModeCode || DEFAULT_CONSULTATION_MODE;
    const priorityCode =
      payload.priorityCode || (urgencyCode === DEFAULT_URGENCY_CODE ? 'in-progress' : 'immediate-6h');

    await assertMatterStageCode(stageCode, connection);
    await assertMatterStatusCode(statusCode, connection);
    assertMatterPriorityCode(priorityCode);

    const urgencyRule = firstRow(
      await queryRows<UrgencyRuleRow>(
        `SELECT id
         FROM pricing_urgency_rules
         WHERE urgency_code = ?
           AND is_active = 1
         LIMIT 1`,
        [urgencyCode],
        connection
      )
    );

    if (!urgencyRule) {
      throw badRequest('invalid_urgency_rule', 'The selected urgency rule is not configured.');
    }

    const consultationMode = firstRow(
      await queryRows<RowDataPacket & { code: string }>(
        `SELECT code
         FROM consultation_modes
         WHERE code = ?
           AND is_active = 1
         LIMIT 1`,
        [consultationModeCode],
        connection
      )
    );

    if (!consultationMode) {
      throw badRequest('invalid_consultation_mode', 'The selected consultation mode is not configured.');
    }

    const matterNumber = await allocateBusinessNumber(connection, 'matter', 'GLMG');
    const nextMatterPublicId = createPublicId();
    const summary =
      payload.summary?.trim() ||
      'Matter opened by Global LMG operations for service coordination and client support.';

    const insertResult = await executeStatement<ResultSetHeader>(
      `INSERT INTO matters (
         public_id,
         matter_number,
         service_request_id,
         client_account_id,
         opened_by_user_id,
         legal_domain_id,
         title,
         issue_summary,
         detailed_description,
         current_stage_code,
         operational_status_code,
         consultation_mode_code,
         urgency_rule_id,
         priority_code,
         quoted_total_amount,
         paid_total_amount,
         refunded_total_amount,
         due_total_amount,
         opened_at,
         last_activity_at,
         closed_at,
         created_at,
         updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        nextMatterPublicId,
        matterNumber,
        clientMeta.clientAccountId,
        actor.userId,
        legalDomain.id,
        payload.title.trim(),
        summary.slice(0, 500),
        summary,
        stageCode,
        statusCode,
        consultationModeCode,
        urgencyRule.id,
        priorityCode,
      ],
      connection
    );
    const matterDbId = Number(insertResult.insertId);

    for (const service of serviceRows) {
      await executeStatement(
        `INSERT INTO matter_services (
           matter_id,
           service_id,
           final_fee,
           service_status_code,
           completed_at,
           created_at
         ) VALUES (?, ?, 0, 'selected', NULL, UTC_TIMESTAMP(6))`,
        [matterDbId, service.id],
        connection
      );
    }

    await executeStatement(
      `INSERT INTO matter_stage_history (
         matter_id,
         stage_code,
         entered_at,
         exited_at,
         changed_by_user_id,
         visible_to_client,
         change_note
       ) VALUES (?, ?, UTC_TIMESTAMP(6), NULL, ?, ?, ?)`,
      [
        matterDbId,
        stageCode,
        actor.userId,
        payload.clientVisible ? 1 : 0,
        'Matter opened from the admin console.',
      ],
      connection
    );

    await executeStatement(
      `INSERT INTO matter_updates (
         matter_id,
         update_type_code,
         title,
         body_text,
         visible_to_client,
         created_by_user_id,
         created_at,
         edited_at
       ) VALUES (?, 'note', 'Matter Created', ?, ?, ?, UTC_TIMESTAMP(6), NULL)`,
      [
        matterDbId,
        `Global LMG opened this coordination workspace for ${clientMeta.clientName}.`,
        payload.clientVisible ? 1 : 0,
        actor.userId,
      ],
      connection
    );

    if (payload.clientVisible) {
      await createClientNotifications(
        {
          bodyText: 'A new Global LMG matter workspace is available in your client portal.',
          clientAccountId: clientMeta.clientAccountId,
          matterId: matterDbId,
          notificationTypeCode: 'matter_update',
          priorityCode: 'normal',
          title: 'Matter workspace created',
        },
        connection
      );
    }

    await createAuditEvent(
      {
        actionCode: 'matter.created',
        actionLabel: 'Matter created',
        actorRoleCode: actor.roleCodes[0] || 'case_manager',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'client_account_id', newValue: payload.clientAccountPublicId },
          { fieldName: 'title', newValue: payload.title.trim() },
          { fieldName: 'legal_domain_id', newValue: legalDomain.id },
          { fieldName: 'current_stage_code', newValue: stageCode },
          { fieldName: 'operational_status_code', newValue: statusCode },
          { fieldName: 'client_visible', newValue: Boolean(payload.clientVisible) },
          { fieldName: 'selected_services', newValue: selectedServiceCodes },
        ],
        entityPk: matterDbId,
        entityTableName: 'matters',
        sourceModule: 'matter_desk',
        summaryNewValue: {
          matterId: nextMatterPublicId,
          matterNumber,
          title: payload.title.trim(),
        },
      },
      connection
    );

    return nextMatterPublicId;
  });

  const matters = await fetchMatters({ actor, matterIds: [matterPublicId] });

  return {
    matter: matters[0],
    status: 'created' as const,
  };
};

export const updateMatterStage = async (
  actor: AdminActor,
  matterId: string,
  payload: {
    changeNote?: string;
    operationalStatusCode?: string;
    stageCode: string;
    visibleToClient?: boolean;
  }
) => {
  return withTransaction(async (connection) => {
    await assertMatterMutationScope(actor, matterId, connection);
    const matter = await resolveMatterByPublicId(matterId, connection);
    const metaRows = await queryRows<MatterUpdateRow>(
      `SELECT
         client_account_id AS clientAccountId,
         current_stage_code AS currentStageCode,
         operational_status_code AS operationalStatusCode,
         issue_summary AS issueSummary,
         priority_code AS priorityCode,
         quoted_total_amount AS quotedTotalAmount,
         paid_total_amount AS paidAmount
       FROM matters
       WHERE id = ?
       LIMIT 1`,
      [matter.id],
      connection
    );
    const meta = metaRows[0];
    const nextStatusCode = payload.operationalStatusCode || undefined;

    if (!meta) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    await assertMatterStageCode(payload.stageCode, connection);
    if (nextStatusCode) {
      await assertMatterStatusCode(nextStatusCode, connection);
    }

    assertMatterCanMutate(meta, nextStatusCode);
    const statusChanged = Boolean(nextStatusCode && nextStatusCode !== meta.operationalStatusCode);
    const stageChanged = payload.stageCode !== meta.currentStageCode;

    await executeStatement(
      `UPDATE matters
       SET current_stage_code = ?,
           operational_status_code = COALESCE(?, operational_status_code),
           last_activity_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [payload.stageCode, payload.operationalStatusCode || null, matter.id],
      connection
    );

    await executeStatement(
      `UPDATE matter_stage_history
       SET exited_at = UTC_TIMESTAMP(6)
       WHERE matter_id = ?
         AND exited_at IS NULL`,
      [matter.id],
      connection
    );

    await executeStatement(
      `INSERT INTO matter_stage_history (
         matter_id,
         stage_code,
         entered_at,
         exited_at,
         changed_by_user_id,
         visible_to_client,
         change_note
       ) VALUES (?, ?, UTC_TIMESTAMP(6), NULL, ?, ?, ?)`,
      [matter.id, payload.stageCode, actor.userId, payload.visibleToClient ? 1 : 0, payload.changeNote || null],
      connection
    );

    await touchMatterActivity(matter.id, connection);

    await createAuditEvent(
      {
        actionCode: 'matter.stage_updated',
        actionLabel: 'Matter stage updated',
        actorRoleCode: actor.roleCodes[0] || 'case_manager',
        actorUserId: actor.userId,
        changes: [
          {
            fieldName: 'current_stage_code',
            oldValue: meta?.currentStageCode,
            newValue: payload.stageCode,
          },
          payload.operationalStatusCode
            ? {
                fieldName: 'operational_status_code',
                oldValue: meta?.operationalStatusCode,
                newValue: payload.operationalStatusCode,
              }
            : null,
        ].filter(Boolean) as Array<{ fieldName: string; oldValue?: unknown; newValue?: unknown }>,
        entityPk: matter.id,
        entityTableName: 'matters',
        sourceModule: 'matter_detail',
        summaryOldValue: meta?.currentStageCode,
        summaryNewValue: payload.stageCode,
      },
      connection
    );

    if (statusChanged) {
      await createAuditEvent(
        {
          actionCode: 'matter.status_updated',
          actionLabel: 'Matter status updated',
          actorRoleCode: actor.roleCodes[0] || 'case_manager',
          actorUserId: actor.userId,
          changes: [
            {
              fieldName: 'operational_status_code',
              oldValue: meta.operationalStatusCode,
              newValue: nextStatusCode,
            },
          ],
          entityPk: matter.id,
          entityTableName: 'matters',
          sourceModule: 'matter_detail',
          summaryOldValue: meta.operationalStatusCode,
          summaryNewValue: nextStatusCode,
        },
        connection
      );
    }

    if (payload.visibleToClient) {
      await createClientNotifications(
        {
          bodyText:
            payload.changeNote ||
            (stageChanged
              ? 'Your matter has moved to the next lifecycle stage.'
              : 'Your matter status has been updated.'),
          clientAccountId: meta.clientAccountId,
          matterId: matter.id,
          notificationTypeCode: 'matter_update',
          priorityCode: 'normal',
          title: 'Matter stage updated',
        },
        connection
      );
    }

    return { status: 'updated' as const };
  });
};

export const addMatterNote = async (
  actor: AdminActor,
  matterId: string,
  payload: {
    bodyText: string;
    title: string;
    visibleToClient?: boolean;
  }
) => {
  return withTransaction(async (connection) => {
    await assertMatterMutationScope(actor, matterId, connection);
    const matter = await resolveMatterByPublicId(matterId, connection);
    const metaRows = await queryRows<MatterUpdateRow>(
      `SELECT
         client_account_id AS clientAccountId,
         operational_status_code AS operationalStatusCode
       FROM matters
       WHERE id = ?
       LIMIT 1`,
      [matter.id],
      connection
    );
    const meta = metaRows[0];

    if (!meta) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    assertMatterCanMutate(meta);

    await executeStatement(
      `INSERT INTO matter_updates (
         matter_id,
         update_type_code,
         title,
         body_text,
         visible_to_client,
         created_by_user_id,
         created_at,
         edited_at
       ) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), NULL)`,
      [
        matter.id,
        payload.visibleToClient ? 'client-update' : 'internal-note',
        payload.title,
        payload.bodyText,
        payload.visibleToClient ? 1 : 0,
        actor.userId,
      ],
      connection
    );

    await touchMatterActivity(matter.id, connection);

    await createAuditEvent(
      {
        actionCode: 'matter.update_created',
        actionLabel: payload.visibleToClient ? 'Client-visible update added' : 'Internal note added',
        actorRoleCode: actor.roleCodes[0] || 'case_manager',
        actorUserId: actor.userId,
        changes: [{ fieldName: 'body_text', newValue: payload.bodyText }],
        entityPk: matter.id,
        entityTableName: 'matters',
        sourceModule: 'matter_detail',
        summaryNewValue: payload.bodyText,
      },
      connection
    );

    if (payload.visibleToClient) {
      await createClientNotifications(
        {
          bodyText: payload.bodyText,
          clientAccountId: meta.clientAccountId,
          matterId: matter.id,
          notificationTypeCode: 'matter_update',
          priorityCode: 'normal',
          title: payload.title,
        },
        connection
      );
    }

    return { status: 'created' as const };
  });
};

export const createMatterAssignment = async (
  actor: AdminActor,
  matterId: string,
  payload: {
    assignmentRoleCode: string;
    counselPartnerId?: string;
    feeAgreedAmount?: number;
    feeDueAmount?: number;
    feePaidAmount?: number;
    internalUserId?: string;
    isPrimary?: boolean;
    notes?: string;
    visibleToClient?: boolean;
  }
) => {
  return withTransaction(async (connection) => {
    await assertMatterMutationScope(actor, matterId, connection);
    const matter = await resolveMatterByPublicId(matterId, connection);
    const metaRows = await queryRows<MatterUpdateRow>(
      `SELECT operational_status_code AS operationalStatusCode
       FROM matters
       WHERE id = ?
       LIMIT 1`,
      [matter.id],
      connection
    );
    const meta = metaRows[0];

    if (!meta) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    assertMatterCanMutate(meta);

    const hasInternalAssignee = Boolean(payload.internalUserId);
    const hasCounselAssignee = Boolean(payload.counselPartnerId);
    if (hasInternalAssignee === hasCounselAssignee) {
      throw badRequest(
        'assignment_target_invalid',
        'Select exactly one internal staff member or counsel partner for this assignment.'
      );
    }

    const internalUser = payload.internalUserId
      ? await resolveInternalUserByPublicId(payload.internalUserId, connection)
      : null;
    const counsel = payload.counselPartnerId
      ? await resolveCounselByPublicId(payload.counselPartnerId, connection)
      : null;

    if (internalUser) {
      const staffRow = firstRow(
        await queryRows<RowDataPacket & { id: number }>(
          `SELECT sp.user_id AS id
           FROM staff_profiles sp
           INNER JOIN users u ON u.id = sp.user_id
           WHERE sp.user_id = ?
             AND sp.employment_status_code = 'active'
             AND u.archived_at IS NULL
           LIMIT 1`,
          [internalUser.id],
          connection
        )
      );

      if (!staffRow) {
        throw badRequest('invalid_assignment_staff', 'Select an active internal coordination staff entry.');
      }
    }

    if (counsel) {
      const counselRow = firstRow(
        await queryRows<RowDataPacket & { id: number; partnerType: string }>(
          `SELECT id, COALESCE(partner_type_code, 'external_counsel') AS partnerType
           FROM counsel_partners
           WHERE id = ?
             AND archived_at IS NULL
             AND partner_status_code = 'active'
           LIMIT 1`,
          [counsel.id],
          connection
        )
      );

      if (!counselRow) {
        throw badRequest('invalid_assignment_counsel', 'Select an active external counsel or field partner entry.');
      }

      if (
        (payload.assignmentRoleCode === 'external_counsel' || payload.assignmentRoleCode === 'field_partner') &&
        counselRow.partnerType !== payload.assignmentRoleCode
      ) {
        throw badRequest('invalid_assignment_counsel', 'Assignment role must match the counsel profile type.');
      }
    }

    const duplicateRows = internalUser
      ? await queryRows<RowDataPacket & { id: number }>(
          `SELECT id
           FROM matter_assignments
           WHERE matter_id = ?
             AND assignment_role_code = ?
             AND internal_user_id = ?
             AND counsel_partner_id IS NULL
             AND assignment_status_code = 'active'
             AND removed_at IS NULL
           LIMIT 1`,
          [matter.id, payload.assignmentRoleCode, internalUser.id],
          connection
        )
      : await queryRows<RowDataPacket & { id: number }>(
          `SELECT id
           FROM matter_assignments
           WHERE matter_id = ?
             AND assignment_role_code = ?
             AND internal_user_id IS NULL
             AND counsel_partner_id = ?
             AND assignment_status_code = 'active'
             AND removed_at IS NULL
           LIMIT 1`,
          [matter.id, payload.assignmentRoleCode, counsel!.id],
          connection
        );

    if (duplicateRows[0]) {
      throw badRequest('duplicate_active_assignment', 'This assignee already has an active assignment for this matter and role.');
    }

    if (payload.isPrimary) {
      await executeStatement(
        `UPDATE matter_assignments
         SET removed_at = UTC_TIMESTAMP(6)
         WHERE matter_id = ?
           AND assignment_role_code = ?
           AND removed_at IS NULL
           AND is_primary = 1`,
        [matter.id, payload.assignmentRoleCode],
        connection
      );
    }

    await executeStatement(
      `INSERT INTO matter_assignments (
         matter_id,
         assignment_role_code,
         internal_user_id,
         counsel_partner_id,
         is_primary,
         visible_to_client,
         fee_agreed_amount,
         fee_paid_amount,
         fee_due_amount,
         assigned_by_user_id,
         assigned_at,
         removed_at,
         assignment_status_code,
         notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), NULL, 'active', ?)`,
      [
        matter.id,
        payload.assignmentRoleCode,
        internalUser?.id || null,
        counsel?.id || null,
        payload.isPrimary ? 1 : 0,
        (payload.visibleToClient ?? true) ? 1 : 0,
        payload.feeAgreedAmount ?? null,
        payload.feePaidAmount ?? null,
        payload.feeDueAmount ?? null,
        actor.userId,
        payload.notes || null,
      ],
      connection
    );

    await touchMatterActivity(matter.id, connection);

    await createAuditEvent(
      {
        actionCode: 'matter.assignment_updated',
        actionLabel: 'Matter assignment updated',
        actorRoleCode: actor.roleCodes[0] || 'case_manager',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'assignment_role_code', newValue: payload.assignmentRoleCode },
          { fieldName: 'internal_user_id', newValue: payload.internalUserId },
          { fieldName: 'counsel_partner_id', newValue: payload.counselPartnerId },
          { fieldName: 'visible_to_client', newValue: payload.visibleToClient ?? true },
        ],
        entityPk: matter.id,
        entityTableName: 'matters',
        sourceModule: 'matter_detail',
        summaryNewValue: payload.assignmentRoleCode,
      },
      connection
    );

    return { status: 'created' as const };
  });
};

export const replaceMatterAssignments = async (
  actor: AdminActor,
  matterId: string,
  payload: {
    externalCounsel?: Array<{ id: string; visibleToClient?: boolean }>;
    fieldPartners?: Array<{ id: string; visibleToClient?: boolean }>;
    staff?: Array<{ id: string; visibleToClient?: boolean }>;
  }
) =>
  withTransaction(async (connection) => {
    const matter = await resolveMatterByPublicId(matterId, connection);
    const meta = firstRow(
      await queryRows<MatterUpdateRow>(
        `SELECT operational_status_code AS operationalStatusCode
         FROM matters
         WHERE id = ?
         LIMIT 1`,
        [matter.id],
        connection
      )
    );

    if (!meta) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    assertMatterCanMutate(meta);

    const staff = payload.staff || [];
    const externalCounsel = payload.externalCounsel || [];
    const fieldPartners = payload.fieldPartners || [];
    const uniqueKeys = new Set<string>();

    const ensureUnique = (key: string) => {
      if (uniqueKeys.has(key)) {
        throw badRequest('duplicate_assignment', 'Each person can only be assigned once per matter.');
      }
      uniqueKeys.add(key);
    };

    const staffRows = [] as Array<{ id: number; publicId: string; visibleToClient: boolean }>;
    for (const entry of staff) {
      ensureUnique(`staff:${entry.id}`);
      const internalUser = await resolveInternalUserByPublicId(entry.id, connection);
      const activeStaff = firstRow(
        await queryRows<RowDataPacket & { id: number }>(
          `SELECT sp.user_id AS id
           FROM staff_profiles sp
           INNER JOIN users u ON u.id = sp.user_id
           WHERE sp.user_id = ?
             AND sp.employment_status_code = 'active'
             AND u.archived_at IS NULL
           LIMIT 1`,
          [internalUser.id],
          connection
        )
      );

      if (!activeStaff) {
        throw badRequest('invalid_assignment_staff', 'Select active internal coordination staff entries.');
      }

      staffRows.push({ id: internalUser.id, publicId: entry.id, visibleToClient: entry.visibleToClient ?? true });
    }

    const counselRows = [] as Array<{
      id: number;
      publicId: string;
      roleCode: 'external_counsel' | 'field_partner';
      visibleToClient: boolean;
    }>;

    for (const [roleCode, entries] of [
      ['external_counsel', externalCounsel],
      ['field_partner', fieldPartners],
    ] as const) {
      for (const entry of entries) {
        ensureUnique(`${roleCode}:${entry.id}`);
        const counsel = await resolveCounselByPublicId(entry.id, connection);
        const activeCounsel = firstRow(
          await queryRows<RowDataPacket & { id: number; partnerType: string }>(
            `SELECT id, COALESCE(partner_type_code, 'external_counsel') AS partnerType
             FROM counsel_partners
             WHERE id = ?
               AND archived_at IS NULL
               AND partner_status_code = 'active'
             LIMIT 1`,
            [counsel.id],
            connection
          )
        );

        if (!activeCounsel || activeCounsel.partnerType !== roleCode) {
          throw badRequest(
            'invalid_assignment_counsel',
            roleCode === 'field_partner'
              ? 'Select active field partner entries.'
              : 'Select active external counsel entries.'
          );
        }

        counselRows.push({ id: counsel.id, publicId: entry.id, roleCode, visibleToClient: entry.visibleToClient ?? true });
      }
    }

    await executeStatement(
      `UPDATE matter_assignments
       SET removed_at = UTC_TIMESTAMP(6),
           assignment_status_code = 'inactive'
       WHERE matter_id = ?
         AND removed_at IS NULL
         AND assignment_status_code = 'active'`,
      [matter.id],
      connection
    );

    for (const entry of staffRows) {
      await executeStatement(
        `INSERT INTO matter_assignments (
           matter_id, assignment_role_code, internal_user_id, counsel_partner_id, is_primary,
           visible_to_client, assigned_by_user_id, assigned_at, removed_at, assignment_status_code, notes
         ) VALUES (?, 'internal_staff', ?, NULL, 0, ?, ?, UTC_TIMESTAMP(6), NULL, 'active', NULL)`,
        [matter.id, entry.id, entry.visibleToClient ? 1 : 0, actor.userId],
        connection
      );
    }

    for (const entry of counselRows) {
      await executeStatement(
        `INSERT INTO matter_assignments (
           matter_id, assignment_role_code, internal_user_id, counsel_partner_id, is_primary,
           visible_to_client, assigned_by_user_id, assigned_at, removed_at, assignment_status_code, notes
         ) VALUES (?, ?, NULL, ?, 0, ?, ?, UTC_TIMESTAMP(6), NULL, 'active', NULL)`,
        [matter.id, entry.roleCode, entry.id, entry.visibleToClient ? 1 : 0, actor.userId],
        connection
      );
    }

    await touchMatterActivity(matter.id, connection);

    await createAuditEvent(
      {
        actionCode: 'matter.assignment_updated',
        actionLabel: 'Matter assignment set replaced',
        actorRoleCode: actor.roleCodes[0] || 'case_manager',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'internal_staff', newValue: staffRows.map((entry) => entry.publicId) },
          { fieldName: 'external_counsel', newValue: counselRows.filter((entry) => entry.roleCode === 'external_counsel').map((entry) => entry.publicId) },
          { fieldName: 'field_partners', newValue: counselRows.filter((entry) => entry.roleCode === 'field_partner').map((entry) => entry.publicId) },
        ],
        entityPk: matter.id,
        entityTableName: 'matters',
        sourceModule: 'matter_detail',
        summaryNewValue: `${staffRows.length} staff, ${
          counselRows.filter((entry) => entry.roleCode === 'external_counsel').length
        } counsel, ${counselRows.filter((entry) => entry.roleCode === 'field_partner').length} field partners`,
      },
      connection
    );

    return { status: 'updated' as const };
  });

export const updateMatterDetails = async (
  actor: AdminActor,
  matterId: string,
  payload: {
    issueSummary?: string;
    operationalStatusCode?: string;
    priorityCode?: string;
    quotedTotalAmount?: number;
    selectedServices?: string[];
  }
) => {
  return withTransaction(async (connection) => {
    await assertMatterMutationScope(actor, matterId, connection);
    assertMatterDetailUpdateFields(actor, payload);
    const matter = await resolveMatterByPublicId(matterId, connection);
    const metaRows = await queryRows<MatterUpdateRow>(
      `SELECT
         client_account_id AS clientAccountId,
         current_stage_code AS currentStageCode,
         operational_status_code AS operationalStatusCode,
         issue_summary AS issueSummary,
         priority_code AS priorityCode,
         quoted_total_amount AS quotedTotalAmount,
         paid_total_amount AS paidAmount
       FROM matters
       WHERE id = ?
       LIMIT 1`,
      [matter.id],
      connection
    );
    const meta = metaRows[0];

    if (!meta) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    if (payload.operationalStatusCode) {
      await assertMatterStatusCode(payload.operationalStatusCode, connection);
    }

    if (payload.priorityCode) {
      assertMatterPriorityCode(payload.priorityCode);
    }

    if (payload.selectedServices && payload.selectedServices.length === 0) {
      throw badRequest('matter_services_required', 'Select at least one service for the matter.');
    }

    assertMatterCanMutate(meta, payload.operationalStatusCode);

    const nextQuotedAmount = payload.quotedTotalAmount ?? meta.quotedTotalAmount;
    const nextDueAmount = Math.max(nextQuotedAmount - meta.paidAmount, 0);
    const statusChanged = Boolean(
      payload.operationalStatusCode && payload.operationalStatusCode !== meta.operationalStatusCode
    );

    await executeStatement(
      `UPDATE matters
       SET issue_summary = COALESCE(?, issue_summary),
           operational_status_code = COALESCE(?, operational_status_code),
           priority_code = COALESCE(?, priority_code),
           quoted_total_amount = ?,
           due_total_amount = ?,
           last_activity_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [
        payload.issueSummary ?? null,
        payload.operationalStatusCode ?? null,
        payload.priorityCode ?? null,
        nextQuotedAmount,
        nextDueAmount,
        matter.id,
      ],
      connection
    );

    if (payload.selectedServices) {
      const serviceRows = await queryRows<RowDataPacket & { id: number; serviceCode: string }>(
        `SELECT id, service_code AS serviceCode
         FROM services
         WHERE service_code IN (${payload.selectedServices.map(() => '?').join(', ')})`,
        payload.selectedServices,
        connection
      );

      if (serviceRows.length !== payload.selectedServices.length) {
        throw badRequest('invalid_service_codes', 'One or more selected services are invalid.');
      }

      await executeStatement(`DELETE FROM matter_services WHERE matter_id = ?`, [matter.id], connection);

      for (const [index, serviceCode] of payload.selectedServices.entries()) {
        const service = serviceRows.find((row) => row.serviceCode === serviceCode);
        if (!service) {
          continue;
        }

        await executeStatement(
          `INSERT INTO matter_services (
             matter_id,
             service_id,
             final_fee,
             service_status_code,
             completed_at,
             created_at
           ) VALUES (?, ?, 0, 'active', NULL, UTC_TIMESTAMP(6))`,
          [matter.id, service.id],
          connection
        );
      }
    }

    await touchMatterActivity(matter.id, connection);

    await createAuditEvent(
      {
        actionCode: 'matter.updated',
        actionLabel: 'Matter details updated',
        actorRoleCode: actor.roleCodes[0] || 'case_manager',
        actorUserId: actor.userId,
        changes: [
          payload.issueSummary !== undefined
            ? { fieldName: 'issue_summary', oldValue: meta.issueSummary, newValue: payload.issueSummary }
            : null,
          payload.operationalStatusCode !== undefined
            ? {
                fieldName: 'operational_status_code',
                oldValue: meta.operationalStatusCode,
                newValue: payload.operationalStatusCode,
              }
            : null,
          payload.quotedTotalAmount !== undefined
            ? {
                fieldName: 'quoted_total_amount',
                oldValue: meta.quotedTotalAmount,
                newValue: payload.quotedTotalAmount,
              }
            : null,
          payload.priorityCode !== undefined
            ? {
                fieldName: 'priority_code',
                oldValue: meta.priorityCode,
                newValue: payload.priorityCode,
              }
            : null,
          payload.selectedServices !== undefined
            ? { fieldName: 'selected_services', newValue: payload.selectedServices }
            : null,
        ].filter(Boolean) as Array<{ fieldName: string; oldValue?: unknown; newValue?: unknown }>,
        entityPk: matter.id,
        entityTableName: 'matters',
        sourceModule: 'matter_detail',
      },
      connection
    );

    if (statusChanged) {
      await createAuditEvent(
        {
          actionCode: 'matter.status_updated',
          actionLabel: 'Matter status updated',
          actorRoleCode: actor.roleCodes[0] || 'case_manager',
          actorUserId: actor.userId,
          changes: [
            {
              fieldName: 'operational_status_code',
              oldValue: meta.operationalStatusCode,
              newValue: payload.operationalStatusCode,
            },
          ],
          entityPk: matter.id,
          entityTableName: 'matters',
          sourceModule: 'matter_detail',
          summaryOldValue: meta.operationalStatusCode,
          summaryNewValue: payload.operationalStatusCode,
        },
        connection
      );

      await createClientNotifications(
        {
          bodyText: 'Your matter status has been updated in your Global LMG dashboard.',
          clientAccountId: meta.clientAccountId,
          matterId: matter.id,
          notificationTypeCode: 'matter_update',
          priorityCode: 'normal',
          title: 'Matter status updated',
        },
        connection
      );
    }

    return { status: 'updated' as const };
  });
};
