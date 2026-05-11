import type { RowDataPacket } from 'mysql2/promise';
import { forbidden } from '../../lib/httpErrors.js';
import { queryRows, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';

type IdRow = RowDataPacket & { id: number };
type ExistsRow = RowDataPacket & { ok: number };

type ScopeEntity = 'client_account' | 'document' | 'event' | 'matter' | 'message_thread';
type ScopedIds = number[] | null;

export type AdminAccessScope = {
  canAccessAll: boolean;
  hasAssignedMatterScope: boolean;
  isAdvocate: boolean;
  isBillingStaff: boolean;
  isCaseStaff: boolean;
};

export type AssignedRecordScopeFilters = {
  clientAccountDbIds?: number[];
  matterDbIds?: number[];
};

const hasRole = (actor: AdminActor, roleCode: string) => actor.roleCodes.includes(roleCode);
export const hasAdminPermission = (actor: AdminActor, permissionCode: string) =>
  actor.permissionCodes.includes(permissionCode);

export const getAdminAccessScope = (actor: AdminActor): AdminAccessScope => {
  const canAccessAll = hasRole(actor, 'ops_admin');
  const isCaseStaff = hasRole(actor, 'case_staff');
  const isAdvocate = hasRole(actor, 'advocate');

  return {
    canAccessAll,
    hasAssignedMatterScope: isCaseStaff || isAdvocate,
    isAdvocate,
    isBillingStaff: hasRole(actor, 'billing_staff'),
    isCaseStaff,
  };
};

const idPredicate = (alias: string, id: number | string) => {
  if (typeof id === 'number') {
    return { params: [id], sql: `${alias}.id = ?` };
  }

  return { params: [id.trim()], sql: `${alias}.public_id = ?` };
};

const assertUsableId = (id: number | string) => {
  if (typeof id === 'number') {
    return Number.isFinite(id) && id > 0;
  }

  return id.trim().length > 0;
};

const buildMatterAssignmentPredicate = (actor: AdminActor, matterAlias: string) => {
  const scope = getAdminAccessScope(actor);
  const predicates: string[] = [];
  const params: unknown[] = [];

  if (scope.isCaseStaff) {
    predicates.push(`
      EXISTS (
        SELECT 1
        FROM matter_assignments ma
        INNER JOIN staff_profiles sp
          ON sp.user_id = ma.internal_user_id
         AND sp.employment_status_code = 'active'
        WHERE ma.matter_id = ${matterAlias}.id
          AND ma.internal_user_id = ?
          AND ma.assignment_status_code = 'active'
          AND ma.removed_at IS NULL
      )`);
    params.push(actor.userId);
  }

  if (scope.isAdvocate) {
    predicates.push(`
      EXISTS (
        SELECT 1
        FROM matter_assignments ma
        INNER JOIN counsel_partner_users cpu
          ON cpu.counsel_partner_id = ma.counsel_partner_id
         AND cpu.user_id = ?
         AND cpu.relationship_status_code = 'active'
         AND cpu.archived_at IS NULL
        INNER JOIN counsel_partners cp
          ON cp.id = cpu.counsel_partner_id
         AND cp.archived_at IS NULL
         AND cp.partner_status_code = 'active'
         AND COALESCE(cp.partner_type_code, 'external_counsel') = 'external_counsel'
        WHERE ma.matter_id = ${matterAlias}.id
          AND ma.assignment_status_code = 'active'
          AND ma.removed_at IS NULL
      )`);
    params.push(actor.userId);
  }

  return {
    params,
    sql: predicates.length > 0 ? `(${predicates.join(' OR ')})` : 'FALSE',
  };
};

const exists = async (sql: string, params: unknown[], executor?: QueryExecutor) => {
  const rows = await queryRows<ExistsRow>(sql, params, executor);
  return Boolean(rows[0]?.ok);
};

const deny = (entity: ScopeEntity): never => {
  throw forbidden(`${entity}_scope_forbidden`, 'You do not have access to this record.');
};

export const getScopedMatterIds = async (
  actor: AdminActor,
  executor?: QueryExecutor
): Promise<ScopedIds> => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return null;
  }

  const selects: string[] = [];
  const params: unknown[] = [];

  if (scope.isCaseStaff) {
    selects.push(`
      SELECT ma.matter_id AS id
      FROM matter_assignments ma
      INNER JOIN matters m
        ON m.id = ma.matter_id
       AND m.archived_at IS NULL
      INNER JOIN staff_profiles sp
        ON sp.user_id = ma.internal_user_id
       AND sp.employment_status_code = 'active'
      WHERE ma.internal_user_id = ?
        AND ma.assignment_status_code = 'active'
        AND ma.removed_at IS NULL`);
    params.push(actor.userId);
  }

  if (scope.isAdvocate) {
    selects.push(`
      SELECT ma.matter_id AS id
      FROM matter_assignments ma
      INNER JOIN matters m
        ON m.id = ma.matter_id
       AND m.archived_at IS NULL
      INNER JOIN counsel_partner_users cpu
        ON cpu.counsel_partner_id = ma.counsel_partner_id
       AND cpu.user_id = ?
       AND cpu.relationship_status_code = 'active'
       AND cpu.archived_at IS NULL
      INNER JOIN counsel_partners cp
        ON cp.id = cpu.counsel_partner_id
       AND cp.archived_at IS NULL
       AND cp.partner_status_code = 'active'
       AND COALESCE(cp.partner_type_code, 'external_counsel') = 'external_counsel'
      WHERE ma.assignment_status_code = 'active'
        AND ma.removed_at IS NULL`);
    params.push(actor.userId);
  }

  if (selects.length === 0) {
    return [];
  }

  const rows = await queryRows<IdRow>(
    `SELECT DISTINCT id FROM (${selects.join(' UNION ALL ')}) scoped ORDER BY id ASC`,
    params,
    executor
  );

  return rows.map((row) => Number(row.id));
};

export const getScopedClientAccountIds = async (
  actor: AdminActor,
  executor?: QueryExecutor
): Promise<ScopedIds> => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return null;
  }

  if (!scope.isCaseStaff) {
    return [];
  }

  const rows = await queryRows<IdRow>(
    `SELECT DISTINCT m.client_account_id AS id
     FROM matter_assignments ma
     INNER JOIN matters m
       ON m.id = ma.matter_id
      AND m.archived_at IS NULL
     INNER JOIN client_accounts ca
       ON ca.id = m.client_account_id
      AND ca.archived_at IS NULL
     INNER JOIN staff_profiles sp
       ON sp.user_id = ma.internal_user_id
      AND sp.employment_status_code = 'active'
     WHERE ma.internal_user_id = ?
       AND ma.assignment_status_code = 'active'
       AND ma.removed_at IS NULL
     ORDER BY m.client_account_id ASC`,
    [actor.userId],
    executor
  );

  return rows.map((row) => Number(row.id));
};

export const getAssignedRecordScopeFilters = async (
  actor: AdminActor,
  input: {
    assignedPermission: string;
    fullPermission: string;
    includeClientAccounts?: boolean;
    includeMatters?: boolean;
  },
  executor?: QueryExecutor
): Promise<AssignedRecordScopeFilters> => {
  if (hasAdminPermission(actor, input.fullPermission)) {
    return {};
  }

  if (!hasAdminPermission(actor, input.assignedPermission)) {
    return {
      ...(input.includeClientAccounts ? { clientAccountDbIds: [] } : {}),
      ...(input.includeMatters !== false ? { matterDbIds: [] } : {}),
    };
  }

  const [matterDbIds, clientAccountDbIds] = await Promise.all([
    input.includeMatters === false ? Promise.resolve<ScopedIds>([]) : getScopedMatterIds(actor, executor),
    input.includeClientAccounts ? getScopedClientAccountIds(actor, executor) : Promise.resolve<ScopedIds>([]),
  ]);

  return {
    ...(input.includeClientAccounts && clientAccountDbIds !== null
      ? { clientAccountDbIds }
      : {}),
    ...(input.includeMatters !== false && matterDbIds !== null ? { matterDbIds } : {}),
  };
};

export const canAccessMatter = async (
  actor: AdminActor,
  matterId: number | string,
  executor?: QueryExecutor
) => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return true;
  }

  if (!assertUsableId(matterId) || !scope.hasAssignedMatterScope) {
    return false;
  }

  const id = idPredicate('m', matterId);
  const assignment = buildMatterAssignmentPredicate(actor, 'm');

  return exists(
    `SELECT 1 AS ok
     FROM matters m
     WHERE ${id.sql}
       AND m.archived_at IS NULL
       AND ${assignment.sql}
     LIMIT 1`,
    [...id.params, ...assignment.params],
    executor
  );
};

export const canAccessClientAccount = async (
  actor: AdminActor,
  clientAccountId: number | string,
  executor?: QueryExecutor
) => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return true;
  }

  if (!assertUsableId(clientAccountId) || !scope.isCaseStaff) {
    return false;
  }

  const id = idPredicate('ca', clientAccountId);

  return exists(
    `SELECT 1 AS ok
     FROM client_accounts ca
     WHERE ${id.sql}
       AND ca.archived_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM matters m
         INNER JOIN matter_assignments ma
           ON ma.matter_id = m.id
          AND ma.internal_user_id = ?
          AND ma.assignment_status_code = 'active'
          AND ma.removed_at IS NULL
         INNER JOIN staff_profiles sp
           ON sp.user_id = ma.internal_user_id
          AND sp.employment_status_code = 'active'
         WHERE m.client_account_id = ca.id
           AND m.archived_at IS NULL
       )
     LIMIT 1`,
    [...id.params, actor.userId],
    executor
  );
};

export const canAccessDocument = async (
  actor: AdminActor,
  documentId: number | string,
  executor?: QueryExecutor
) => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return true;
  }

  if (!assertUsableId(documentId) || !scope.hasAssignedMatterScope) {
    return false;
  }

  const id = idPredicate('d', documentId);
  const assignment = buildMatterAssignmentPredicate(actor, 'm');

  return exists(
    `SELECT 1 AS ok
     FROM documents d
     WHERE ${id.sql}
       AND d.archived_at IS NULL
       AND EXISTS (
         SELECT 1
         FROM matter_documents md
         INNER JOIN matters m
           ON m.id = md.matter_id
          AND m.archived_at IS NULL
         WHERE md.document_id = d.id
           AND ${assignment.sql}
       )
     LIMIT 1`,
    [...id.params, ...assignment.params],
    executor
  );
};

export const canAccessMessageThread = async (
  actor: AdminActor,
  threadId: number | string,
  executor?: QueryExecutor
) => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return true;
  }

  if (!assertUsableId(threadId) || !scope.hasAssignedMatterScope) {
    return false;
  }

  const id = idPredicate('ct', threadId);
  const assignment = buildMatterAssignmentPredicate(actor, 'm');

  return exists(
    `SELECT 1 AS ok
     FROM conversation_threads ct
     INNER JOIN matters m
       ON m.id = ct.matter_id
      AND m.archived_at IS NULL
     WHERE ${id.sql}
       AND ct.archived_at IS NULL
       AND ${assignment.sql}
     LIMIT 1`,
    [...id.params, ...assignment.params],
    executor
  );
};

export const canAccessEvent = async (
  actor: AdminActor,
  eventId: number | string,
  executor?: QueryExecutor
) => {
  const scope = getAdminAccessScope(actor);
  if (scope.canAccessAll) {
    return true;
  }

  if (!assertUsableId(eventId) || !scope.hasAssignedMatterScope) {
    return false;
  }

  const id = idPredicate('e', eventId);
  const assignment = buildMatterAssignmentPredicate(actor, 'm');

  return exists(
    `SELECT 1 AS ok
     FROM events e
     INNER JOIN matters m
       ON m.id = e.matter_id
      AND m.archived_at IS NULL
     WHERE ${id.sql}
       AND ${assignment.sql}
     LIMIT 1`,
    [...id.params, ...assignment.params],
    executor
  );
};

export const assertCanAccessMatter = async (
  actor: AdminActor,
  matterId: number | string,
  executor?: QueryExecutor
) => {
  if (!(await canAccessMatter(actor, matterId, executor))) {
    deny('matter');
  }
};

export const assertCanAccessClientAccount = async (
  actor: AdminActor,
  clientAccountId: number | string,
  executor?: QueryExecutor
) => {
  if (!(await canAccessClientAccount(actor, clientAccountId, executor))) {
    deny('client_account');
  }
};

export const assertCanAccessDocument = async (
  actor: AdminActor,
  documentId: number | string,
  executor?: QueryExecutor
) => {
  if (!(await canAccessDocument(actor, documentId, executor))) {
    deny('document');
  }
};

export const assertCanAccessMessageThread = async (
  actor: AdminActor,
  threadId: number | string,
  executor?: QueryExecutor
) => {
  if (!(await canAccessMessageThread(actor, threadId, executor))) {
    deny('message_thread');
  }
};

export const assertCanAccessEvent = async (
  actor: AdminActor,
  eventId: number | string,
  executor?: QueryExecutor
) => {
  if (!(await canAccessEvent(actor, eventId, executor))) {
    deny('event');
  }
};
