import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createPublicId } from '../../lib/authCrypto.js';
import { allocateBusinessNumber } from '../../lib/businessSequences.js';
import { badRequest, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { createAuditEvent, createClientNotifications, touchMatterActivity } from '../writeSupport.js';

type RequestMetricRow = RowDataPacket & {
  convertedThisMonth: number;
  openRequests: number;
  scheduledConsultations: number;
  urgentRequests: number;
};

type RequestRow = RowDataPacket & {
  clientEmail: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  consultationMode: string;
  createdAt: string;
  expertiseArea: string;
  issueSummary: string;
  matterId: string | null;
  matterNumber: string | null;
  ownerName: string | null;
  preferredEndAt: string | null;
  preferredStartAt: string | null;
  quoteTotalAmount: number;
  requestNumber: string;
  selectedServices: string | null;
  statusCode: string;
  statusLabel: string | null;
  title: string;
  urgencyCode: string;
  urgencyLabel: string | null;
  id: string;
};

type DecisionRow = RowDataPacket & {
  clientAccountId: number;
  consultationModeCode: string;
  detailedDescription: string | null;
  id: number;
  issueSummary: string;
  legalDomainId: number;
  matterDbId: number | null;
  matterId: string | null;
  matterNumber: string | null;
  quoteTotalAmount: number;
  requestNumber: string;
  requestedByUserId: number;
  statusCode: string;
  title: string;
  urgencyCode: string;
  urgencyRuleId: number;
};

type ExistingMatterRow = RowDataPacket & {
  dbId: number;
  id: string;
  matterNumber: string;
};

type MatterResolution = {
  created: boolean;
  dbId: number;
  id: string;
  matterNumber: string;
};

export type RequestDecisionPayload = {
  note?: string;
};

export type RequestDecisionResponse = {
  matterId?: string;
  matterNumber?: string;
  message: string;
  requestId: string;
  requestNumber: string;
  status:
    | 'already_approved'
    | 'already_converted'
    | 'already_declined'
    | 'approved'
    | 'converted'
    | 'declined'
    | 'information_requested';
  statusCode: string;
  statusLabel: string;
};

const STATUS_LABELS: Record<string, string> = {
  'awaiting-verification': 'Awaiting Verification',
  converted: 'Converted',
  'lost-closed': 'Lost / Closed',
  'new-lead': 'New Lead',
  submitted: 'Submitted',
};

const TERMINAL_STATUSES = new Set(['converted', 'lost-closed']);

const toIso = (value: string | null) => (value ? value.replace(' ', 'T') : undefined);

const toLabel = (value: string) =>
  value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const firstRow = <TRow>(rows: TRow[]) => rows[0] || null;

const normalizeNote = (note: string | undefined) => {
  const trimmed = note?.trim();
  return trimmed || undefined;
};

const actorRoleCode = (actor: AdminActor) => actor.roleCodes[0] || 'case_manager';

const getDecisionRow = async (connection: PoolConnection, requestPublicId: string) => {
  const row = firstRow(
    await queryRows<DecisionRow>(
      `SELECT
         sr.id,
         sr.public_id AS requestId,
         sr.request_number AS requestNumber,
         sr.client_account_id AS clientAccountId,
         sr.requested_by_user_id AS requestedByUserId,
         sr.status_code AS statusCode,
         sr.title,
         sr.issue_summary AS issueSummary,
         sr.detailed_description AS detailedDescription,
         sr.legal_domain_id AS legalDomainId,
         sr.consultation_mode_code AS consultationModeCode,
         sr.urgency_rule_id AS urgencyRuleId,
         sr.quote_total_amount AS quoteTotalAmount,
         pur.urgency_code AS urgencyCode,
         m.id AS matterDbId,
         m.public_id AS matterId,
         m.matter_number AS matterNumber
       FROM service_requests sr
       INNER JOIN pricing_urgency_rules pur ON pur.id = sr.urgency_rule_id
       LEFT JOIN matters m ON m.service_request_id = sr.id AND m.archived_at IS NULL
       WHERE sr.public_id = ?
         AND sr.archived_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [requestPublicId],
      connection
    )
  );

  if (!row) {
    throw notFound('request_not_found', 'Service request not found.');
  }

  return row;
};

const updateRequestStatus = async (
  connection: PoolConnection,
  requestRow: DecisionRow,
  nextStatusCode: string,
  actor: AdminActor,
  changeNote: string
) => {
  if (requestRow.statusCode === nextStatusCode) {
    return false;
  }

  await executeStatement(
    `UPDATE service_requests
     SET status_code = ?,
         updated_at = UTC_TIMESTAMP(6),
         row_version = row_version + 1
     WHERE id = ?`,
    [nextStatusCode, requestRow.id],
    connection
  );

  await executeStatement(
    `INSERT INTO request_status_history (
       service_request_id,
       from_status_code,
       to_status_code,
       changed_by_user_id,
       change_note,
       changed_at
     ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
    [requestRow.id, requestRow.statusCode, nextStatusCode, actor.userId, changeNote],
    connection
  );

  requestRow.statusCode = nextStatusCode;
  return true;
};

const appendMatterUpdate = async (
  connection: PoolConnection,
  input: {
    actorUserId: number;
    bodyText: string;
    matterDbId: number;
    title: string;
    visibleToClient?: boolean;
  }
) => {
  await executeStatement(
    `INSERT INTO matter_updates (
       matter_id,
       update_type_code,
       title,
       body_text,
       visible_to_client,
       created_by_user_id,
       created_at
     ) VALUES (?, 'note', ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
    [
      input.matterDbId,
      input.title,
      input.bodyText,
      input.visibleToClient === false ? 0 : 1,
      input.actorUserId,
    ],
    connection
  );

  await touchMatterActivity(input.matterDbId, connection);
};

const ensureMatterForRequest = async (
  connection: PoolConnection,
  requestRow: DecisionRow,
  actor: AdminActor
): Promise<MatterResolution> => {
  if (requestRow.matterDbId && requestRow.matterId && requestRow.matterNumber) {
    return {
      created: false,
      dbId: Number(requestRow.matterDbId),
      id: requestRow.matterId,
      matterNumber: requestRow.matterNumber,
    };
  }

  const existingMatter = firstRow(
    await queryRows<ExistingMatterRow>(
      `SELECT
         id AS dbId,
         public_id AS id,
         matter_number AS matterNumber
       FROM matters
       WHERE service_request_id = ?
         AND archived_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [requestRow.id],
      connection
    )
  );

  if (existingMatter) {
    requestRow.matterDbId = Number(existingMatter.dbId);
    requestRow.matterId = existingMatter.id;
    requestRow.matterNumber = existingMatter.matterNumber;
    return {
      created: false,
      dbId: Number(existingMatter.dbId),
      id: existingMatter.id,
      matterNumber: existingMatter.matterNumber,
    };
  }

  const matterNumber = await allocateBusinessNumber(connection, 'matter', 'GLMG');
  const matterPublicId = createPublicId();
  const priorityCode = requestRow.urgencyCode === 'standard' ? 'in-progress' : 'immediate-6h';

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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'request-received', 'new-lead', ?, ?, ?, ?, 0, 0, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
    [
      matterPublicId,
      matterNumber,
      requestRow.id,
      requestRow.clientAccountId,
      actor.userId,
      requestRow.legalDomainId,
      requestRow.title,
      requestRow.issueSummary,
      requestRow.detailedDescription,
      requestRow.consultationModeCode,
      requestRow.urgencyRuleId,
      priorityCode,
      Number(requestRow.quoteTotalAmount || 0),
      Number(requestRow.quoteTotalAmount || 0),
    ],
    connection
  );

  const matterDbId = Number(insertResult.insertId);

  await executeStatement(
    `INSERT IGNORE INTO matter_services (
       matter_id,
       service_id,
       final_fee,
       service_status_code,
       completed_at,
       created_at
     )
     SELECT ?, rs.service_id, 0, 'selected', NULL, UTC_TIMESTAMP(6)
     FROM request_services rs
     WHERE rs.service_request_id = ?`,
    [matterDbId, requestRow.id],
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
     ) VALUES (?, 'request-received', UTC_TIMESTAMP(6), NULL, ?, 1, ?)`,
    [matterDbId, actor.userId, 'Matter created from admin request conversion.'],
    connection
  );

  await appendMatterUpdate(connection, {
    actorUserId: actor.userId,
    bodyText: 'Request converted to a client matter by the Global LMG operations team.',
    matterDbId,
    title: 'Matter Created',
  });

  await executeStatement(
    `INSERT IGNORE INTO matter_documents (
       matter_id,
       document_id,
       link_role_code,
       created_at
     )
     SELECT ?, rd.document_id, rd.link_role_code, UTC_TIMESTAMP(6)
     FROM request_documents rd
     WHERE rd.service_request_id = ?`,
    [matterDbId, requestRow.id],
    connection
  );

  requestRow.matterDbId = matterDbId;
  requestRow.matterId = matterPublicId;
  requestRow.matterNumber = matterNumber;

  return {
    created: true,
    dbId: matterDbId,
    id: matterPublicId,
    matterNumber,
  };
};

const auditDecision = async (
  connection: PoolConnection,
  actor: AdminActor,
  requestRow: DecisionRow,
  input: {
    actionCode: string;
    actionLabel: string;
    matterDbId?: number | null;
    newStatusCode: string;
    note?: string;
    oldStatusCode: string;
  }
) => {
  await createAuditEvent(
    {
      actionCode: input.actionCode,
      actionLabel: input.actionLabel,
      actorRoleCode: actorRoleCode(actor),
      actorUserId: actor.userId,
      changes: [
        {
          fieldName: 'status_code',
          newValue: input.newStatusCode,
          oldValue: input.oldStatusCode,
        },
        {
          fieldName: 'admin_note',
          newValue: input.note || null,
          oldValue: null,
        },
      ],
      entityPk: requestRow.id,
      entityTableName: 'service_requests',
      sourceModule: 'requests_workspace',
      summaryNewValue: {
        matterId: input.matterDbId || null,
        requestNumber: requestRow.requestNumber,
        statusCode: input.newStatusCode,
      },
      summaryOldValue: {
        requestNumber: requestRow.requestNumber,
        statusCode: input.oldStatusCode,
      },
    },
    connection
  );
};

const notifyClient = async (
  connection: PoolConnection,
  requestRow: DecisionRow,
  input: {
    bodyText: string;
    matterDbId?: number | null;
    priorityCode?: string;
    title: string;
  }
) => {
  await createClientNotifications(
    {
      bodyText: input.bodyText,
      clientAccountId: requestRow.clientAccountId,
      matterId: input.matterDbId || null,
      notificationTypeCode: 'matter_update',
      priorityCode: input.priorityCode || 'normal',
      title: input.title,
    },
    connection
  );
};

const buildDecisionResponse = (
  requestPublicId: string,
  requestRow: DecisionRow,
  input: {
    matter?: MatterResolution;
    message: string;
    status: RequestDecisionResponse['status'];
  }
): RequestDecisionResponse => ({
  matterId: input.matter?.id || requestRow.matterId || undefined,
  matterNumber: input.matter?.matterNumber || requestRow.matterNumber || undefined,
  message: input.message,
  requestId: requestPublicId,
  requestNumber: requestRow.requestNumber,
  status: input.status,
  statusCode: requestRow.statusCode,
  statusLabel: STATUS_LABELS[requestRow.statusCode] || toLabel(requestRow.statusCode),
});

export const getWorkspace = async () => {
  const [metricRows, requestRows] = await Promise.all([
    queryRows<RequestMetricRow>(
      `SELECT
         SUM(CASE WHEN sr.status_code NOT IN ('draft_payment_pending', 'converted', 'lost-closed') THEN 1 ELSE 0 END) AS openRequests,
         SUM(CASE WHEN pur.urgency_code IN ('within-2hrs', 'within-6hrs')
                    AND sr.status_code NOT IN ('draft_payment_pending', 'converted', 'lost-closed')
                  THEN 1 ELSE 0 END) AS urgentRequests,
         SUM(CASE WHEN sr.preferred_start_at IS NOT NULL THEN 1 ELSE 0 END) AS scheduledConsultations,
         SUM(
           CASE
             WHEN sr.status_code = 'converted'
              AND YEAR(COALESCE(m.opened_at, sr.updated_at, sr.created_at)) = YEAR(UTC_DATE())
              AND MONTH(COALESCE(m.opened_at, sr.updated_at, sr.created_at)) = MONTH(UTC_DATE())
             THEN 1 ELSE 0
           END
         ) AS convertedThisMonth
       FROM service_requests sr
       INNER JOIN pricing_urgency_rules pur ON pur.id = sr.urgency_rule_id
       LEFT JOIN matters m ON m.service_request_id = sr.id AND m.archived_at IS NULL
       WHERE sr.archived_at IS NULL
         AND sr.status_code <> 'draft_payment_pending'`
    ),
    queryRows<RequestRow>(
      `SELECT
         sr.public_id AS id,
         sr.request_number AS requestNumber,
         ca.public_id AS clientId,
         ca.display_name AS clientName,
         ca.primary_email AS clientEmail,
         ca.primary_phone AS clientPhone,
         sr.title,
         sr.issue_summary AS issueSummary,
         ld.domain_name AS expertiseArea,
         sr.status_code AS statusCode,
         rs.label AS statusLabel,
         sr.consultation_mode_code AS consultationMode,
         pur.urgency_code AS urgencyCode,
         pur.label AS urgencyLabel,
         sr.preferred_start_at AS preferredStartAt,
         sr.preferred_end_at AS preferredEndAt,
         sr.quote_total_amount AS quoteTotalAmount,
         sr.created_at AS createdAt,
         owner.display_name AS ownerName,
         matter.public_id AS matterId,
         matter.matter_number AS matterNumber,
         GROUP_CONCAT(services.service_code ORDER BY req_services.sort_order SEPARATOR ',') AS selectedServices
       FROM service_requests sr
       INNER JOIN client_accounts ca ON ca.id = sr.client_account_id
       INNER JOIN legal_domains ld ON ld.id = sr.legal_domain_id
       INNER JOIN pricing_urgency_rules pur ON pur.id = sr.urgency_rule_id
       LEFT JOIN request_statuses rs ON rs.code = sr.status_code
       LEFT JOIN users owner ON owner.id = ca.owner_user_id
       LEFT JOIN matters matter ON matter.service_request_id = sr.id AND matter.archived_at IS NULL
       LEFT JOIN request_services req_services ON req_services.service_request_id = sr.id
       LEFT JOIN services ON services.id = req_services.service_id
       WHERE sr.archived_at IS NULL
         AND sr.status_code <> 'draft_payment_pending'
       GROUP BY
         sr.id,
         sr.public_id,
         sr.request_number,
         ca.public_id,
         ca.display_name,
         ca.primary_email,
         ca.primary_phone,
         sr.title,
         sr.issue_summary,
         ld.domain_name,
         sr.status_code,
         rs.label,
         sr.consultation_mode_code,
         pur.urgency_code,
         pur.label,
         sr.preferred_start_at,
         sr.preferred_end_at,
         sr.quote_total_amount,
         sr.created_at,
         owner.display_name,
         matter.public_id,
         matter.matter_number
       ORDER BY sr.created_at DESC`
    ),
  ]);

  const metrics = metricRows[0] || {
    convertedThisMonth: 0,
    openRequests: 0,
    scheduledConsultations: 0,
    urgentRequests: 0,
  };

  return {
    metrics: {
      convertedThisMonth: Number(metrics.convertedThisMonth || 0),
      openRequests: Number(metrics.openRequests || 0),
      scheduledConsultations: Number(metrics.scheduledConsultations || 0),
      urgentRequests: Number(metrics.urgentRequests || 0),
    },
    requests: requestRows.map((row) => ({
      clientEmail: row.clientEmail,
      clientId: row.clientId,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      consultationMode: row.consultationMode,
      createdAt: row.createdAt.replace(' ', 'T'),
      expertiseArea: row.expertiseArea,
      id: row.id,
      issueSummary: row.issueSummary,
      matterId: row.matterId || undefined,
      matterNumber: row.matterNumber || undefined,
      ownerName: row.ownerName || 'Intake Desk',
      preferredEndAt: toIso(row.preferredEndAt),
      preferredStartAt: toIso(row.preferredStartAt),
      quoteTotalAmount: Number(row.quoteTotalAmount || 0),
      requestNumber: row.requestNumber,
      selectedServices: row.selectedServices ? row.selectedServices.split(',').filter(Boolean) : [],
      statusCode: row.statusCode,
      statusLabel: row.statusLabel || toLabel(row.statusCode),
      title: row.title,
      urgencyCode: row.urgencyCode,
      urgencyLabel: row.urgencyLabel || toLabel(row.urgencyCode),
    })),
  };
};

export const approveRequest = async (
  actor: AdminActor,
  requestPublicId: string,
  payload: RequestDecisionPayload = {}
) => {
  const note = normalizeNote(payload.note);

  return withTransaction(async (connection) => {
    const requestRow = await getDecisionRow(connection, requestPublicId);

    if (requestRow.statusCode === 'awaiting-verification') {
      return buildDecisionResponse(requestPublicId, requestRow, {
        message: 'Request is already marked as approved for verification.',
        status: 'already_approved',
      });
    }

    if (TERMINAL_STATUSES.has(requestRow.statusCode)) {
      throw badRequest(
        'request_transition_invalid',
        'Converted or closed requests cannot be approved again.'
      );
    }

    const oldStatusCode = requestRow.statusCode;
    await updateRequestStatus(
      connection,
      requestRow,
      'awaiting-verification',
      actor,
      note || 'Admin approved request for verification.'
    );

    await auditDecision(connection, actor, requestRow, {
      actionCode: 'request.approved',
      actionLabel: 'Request approved',
      newStatusCode: requestRow.statusCode,
      note,
      oldStatusCode,
    });

    await notifyClient(connection, requestRow, {
      bodyText:
        note ||
        'Your request has been reviewed by the Global LMG operations team. We will confirm the next step shortly.',
      matterDbId: requestRow.matterDbId,
      title: 'Request approved',
    });

    if (requestRow.matterDbId) {
      await appendMatterUpdate(connection, {
        actorUserId: actor.userId,
        bodyText:
          note ||
          'The request has been approved for verification by the Global LMG operations team.',
        matterDbId: requestRow.matterDbId,
        title: 'Request Approved',
      });
    }

    return buildDecisionResponse(requestPublicId, requestRow, {
      message: 'Request approved and the client has been notified.',
      status: 'approved',
    });
  });
};

export const convertRequest = async (
  actor: AdminActor,
  requestPublicId: string,
  payload: RequestDecisionPayload = {}
) => {
  const note = normalizeNote(payload.note);

  return withTransaction(async (connection) => {
    const requestRow = await getDecisionRow(connection, requestPublicId);

    if (requestRow.statusCode === 'lost-closed') {
      throw badRequest('request_transition_invalid', 'Closed requests cannot be converted.');
    }

    const matter = await ensureMatterForRequest(connection, requestRow, actor);

    if (requestRow.statusCode === 'converted') {
      return buildDecisionResponse(requestPublicId, requestRow, {
        matter,
        message: 'Request is already converted and linked to a matter.',
        status: 'already_converted',
      });
    }

    const oldStatusCode = requestRow.statusCode;
    await updateRequestStatus(
      connection,
      requestRow,
      'converted',
      actor,
      note || `Admin converted request to matter ${matter.matterNumber}.`
    );

    if (!matter.created) {
      await appendMatterUpdate(connection, {
        actorUserId: actor.userId,
        bodyText:
          note ||
          'The Global LMG operations team has confirmed this request as an active client matter.',
        matterDbId: matter.dbId,
        title: 'Request Converted',
      });
    }

    await auditDecision(connection, actor, requestRow, {
      actionCode: 'request.converted',
      actionLabel: 'Request converted to matter',
      matterDbId: matter.dbId,
      newStatusCode: requestRow.statusCode,
      note,
      oldStatusCode,
    });

    await notifyClient(connection, requestRow, {
      bodyText:
        note ||
        `Your request is now linked to matter ${matter.matterNumber} in your Global LMG dashboard.`,
      matterDbId: matter.dbId,
      title: matter.created ? 'Matter created' : 'Request converted',
    });

    return buildDecisionResponse(requestPublicId, requestRow, {
      matter,
      message: matter.created
        ? 'Request converted and a matter was created.'
        : 'Request converted and linked to the existing matter.',
      status: 'converted',
    });
  });
};

export const declineRequest = async (
  actor: AdminActor,
  requestPublicId: string,
  payload: RequestDecisionPayload = {}
) => {
  const note = normalizeNote(payload.note);

  return withTransaction(async (connection) => {
    const requestRow = await getDecisionRow(connection, requestPublicId);

    if (requestRow.statusCode === 'lost-closed') {
      return buildDecisionResponse(requestPublicId, requestRow, {
        message: 'Request is already declined or closed.',
        status: 'already_declined',
      });
    }

    if (requestRow.statusCode === 'converted') {
      throw badRequest('request_transition_invalid', 'Converted requests cannot be declined.');
    }

    const oldStatusCode = requestRow.statusCode;
    await updateRequestStatus(
      connection,
      requestRow,
      'lost-closed',
      actor,
      note || 'Admin declined request.'
    );

    await auditDecision(connection, actor, requestRow, {
      actionCode: 'request.declined',
      actionLabel: 'Request declined',
      matterDbId: requestRow.matterDbId,
      newStatusCode: requestRow.statusCode,
      note,
      oldStatusCode,
    });

    await notifyClient(connection, requestRow, {
      bodyText:
        note ||
        'We are unable to proceed with this request through the Global LMG platform at this time.',
      matterDbId: requestRow.matterDbId,
      priorityCode: 'normal',
      title: 'Request declined',
    });

    if (requestRow.matterDbId) {
      await appendMatterUpdate(connection, {
        actorUserId: actor.userId,
        bodyText:
          note ||
          'The Global LMG operations team marked this request as closed in the intake queue.',
        matterDbId: requestRow.matterDbId,
        title: 'Request Declined',
      });
    }

    return buildDecisionResponse(requestPublicId, requestRow, {
      message: 'Request declined and the client has been notified.',
      status: 'declined',
    });
  });
};

export const requestMoreInformation = async (
  actor: AdminActor,
  requestPublicId: string,
  payload: RequestDecisionPayload = {}
) => {
  const note = normalizeNote(payload.note);

  if (!note) {
    throw badRequest(
      'request_info_note_required',
      'A message is required when requesting more information.'
    );
  }

  return withTransaction(async (connection) => {
    const requestRow = await getDecisionRow(connection, requestPublicId);

    if (TERMINAL_STATUSES.has(requestRow.statusCode)) {
      throw badRequest(
        'request_transition_invalid',
        'Converted or closed requests cannot be moved back to information requested.'
      );
    }

    const oldStatusCode = requestRow.statusCode;
    await updateRequestStatus(
      connection,
      requestRow,
      'awaiting-verification',
      actor,
      `More information requested: ${note}`
    );

    await auditDecision(connection, actor, requestRow, {
      actionCode: 'request.information_requested',
      actionLabel: 'Request information requested',
      matterDbId: requestRow.matterDbId,
      newStatusCode: requestRow.statusCode,
      note,
      oldStatusCode,
    });

    await notifyClient(connection, requestRow, {
      bodyText: note,
      matterDbId: requestRow.matterDbId,
      priorityCode: 'normal',
      title: 'More information requested',
    });

    if (requestRow.matterDbId) {
      await appendMatterUpdate(connection, {
        actorUserId: actor.userId,
        bodyText: note,
        matterDbId: requestRow.matterDbId,
        title: 'More Information Requested',
      });
    }

    return buildDecisionResponse(requestPublicId, requestRow, {
      message: 'Information request sent to the client.',
      status: 'information_requested',
    });
  });
};
