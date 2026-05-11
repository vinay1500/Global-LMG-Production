import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { createNumericCode, createPublicId, createRandomToken, hashOpaqueValue, hashPassword } from '../../lib/authCrypto.js';
import { AppError, badRequest, forbidden, notFound } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { sendEmail } from '../providers/email.js';
import { createAuditEvent } from '../writeSupport.js';
import { assertCanAssignRoleCode, canAssignRoleCode } from '../rbac/protectedRoles.js';
import { getAdminMfaRequirementMode } from './platformSettings.js';
import { getPlatformDefaultTimezone } from './platformSettings.js';

export type TeamMemberType = 'external_counsel' | 'field_partner' | 'internal_staff';

export type TeamMemberPayload = {
  active?: boolean;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  name: string;
  phone?: string | null;
  specialization?: string | null;
  state?: string | null;
  type: TeamMemberType;
};

export type UpdateTeamMemberPayload = Partial<TeamMemberPayload>;

export type EnableTeamMemberLoginPayload = {
  note?: string | null;
  requirePasswordRotation?: boolean;
  roleCode?: string | null;
  sendSetupEmail?: boolean;
};

export type UpdateTeamMemberLoginPayload = {
  loginEnabled: boolean;
};

type StaffRegistryRow = RowDataPacket & {
  activeRoleCount: number;
  assignmentCount: number;
  city: string | null;
  email: string;
  employmentStatusCode: string;
  hasCredentials: number;
  id: string;
  loginEnabled: number;
  loginUserId: string;
  name: string;
  phone: string | null;
  specialization: string;
  state: string | null;
};

type CounselRegistryRow = RowDataPacket & {
  active: number;
  activeRoleCount: number | null;
  assignmentCount: number;
  city: string;
  country: string;
  email: string;
  hasCredentials: number | null;
  id: string;
  loginEnabled: number | null;
  loginUserId: string | null;
  name: string;
  phone: string;
  specialization: string | null;
  state: string;
  type: TeamMemberType | null;
};

type IdRow = RowDataPacket & { id: number };
type StaffDetailRow = RowDataPacket & {
  accountStatusCode: string;
  activeRoleCount: number;
  dbId: number;
  email: string;
  employmentStatusCode: string;
  hasCredentials: number;
  id: string;
  loginEnabled: number;
  name: string;
  phone: string | null;
};
type CounselDetailRow = RowDataPacket & {
  activeRoleCount: number | null;
  dbId: number;
  email: string;
  hasCredentials: number | null;
  id: string;
  invitedUserId: number | null;
  linkedLoginEnabled: number | null;
  linkedUserDbId: number | null;
  linkedUserId: string | null;
  name: string;
  partnerStatusCode: string;
  phone: string;
  relationshipStatusCode: string | null;
  type: TeamMemberType | null;
};
type RoleRow = RowDataPacket & {
  code: string;
  isActive: number;
  name: string;
};

type SetupEmailStatus =
  | 'failed'
  | 'manual_required'
  | 'preview'
  | 'sent'
  | 'skipped_provider_disabled';

const TEAM_MEMBER_SETUP_TOKEN_TTL_MINUTES = 30;

const firstRow = <TRow>(rows: TRow[]) => rows[0] || null;

const normalizeOptionalText = (value: string | null | undefined) => {
  const next = value?.trim();
  return next ? next : null;
};

const normalizeRequiredText = (value: string | undefined, fieldName: string) => {
  const next = value?.trim();
  if (!next || next.length < 2) {
    throw badRequest('invalid_team_member', `${fieldName} is required.`);
  }

  return next;
};

const assertEmail = (email: string | null) => {
  if (!email) {
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('invalid_email', 'Enter a valid email address.');
  }
};

const splitName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || name,
    lastName: parts.slice(1).join(' ') || null,
  };
};

const normalizePayload = (payload: TeamMemberPayload): TeamMemberPayload => {
  const name = normalizeRequiredText(payload.name, 'Name');
  const email = normalizeOptionalText(payload.email);
  assertEmail(email);

  return {
    active: payload.active ?? true,
    city: normalizeOptionalText(payload.city),
    country: normalizeOptionalText(payload.country) || 'IN',
    email,
    name,
    phone: normalizeOptionalText(payload.phone),
    specialization: normalizeOptionalText(payload.specialization),
    state: normalizeOptionalText(payload.state),
    type: payload.type,
  };
};

const assertUserEmailAvailable = async (
  email: string | null,
  executor: QueryExecutor,
  excludeUserId?: number
) => {
  if (!email) {
    return;
  }

  const duplicate = firstRow(
    await queryRows<IdRow>(
      `SELECT id
       FROM users
       WHERE LOWER(email) = LOWER(?)
         AND (? IS NULL OR id <> ?)
       LIMIT 1`,
      [email, excludeUserId ?? null, excludeUserId ?? null],
      executor
    )
  );

  if (duplicate) {
    throw new AppError(409, 'team_member_email_exists', 'A user with this email already exists.');
  }
};

const assertCounselEmailAvailable = async (
  email: string | null,
  executor: QueryExecutor,
  excludeCounselId?: number
) => {
  if (!email) {
    return;
  }

  const duplicate = firstRow(
    await queryRows<IdRow>(
      `SELECT id
       FROM counsel_partners
       WHERE archived_at IS NULL
         AND LOWER(email) = LOWER(?)
         AND (? IS NULL OR id <> ?)
       LIMIT 1`,
      [email, excludeCounselId ?? null, excludeCounselId ?? null],
      executor
    )
  );

  if (duplicate) {
    throw new AppError(409, 'team_member_email_exists', 'A registry entry with this email already exists.');
  }
};

const generateCounselCode = (type: TeamMemberType, publicId: string) => {
  const prefix = type === 'field_partner' ? 'FIELD' : 'COUNSEL';
  return `${prefix}-${publicId.slice(-10).toUpperCase()}`;
};

const syntheticStaffEmail = (publicId: string) => `${publicId.toLowerCase()}@staff.local.globallmg`;

const isSyntheticStaffEmail = (email: string) => email.toLowerCase().endsWith('@staff.local.globallmg');

const toMysqlDateTime = (date: Date) => date.toISOString().slice(0, 23).replace('T', ' ');

const primaryActorRole = (actor: AdminActor) => actor.roleCodes[0] || 'ops_admin';

const normalizeRoleCode = (roleCode: string | null | undefined) => roleCode?.trim() || null;

const TEAM_REGISTRY_STAFF_ROLE_CODES = ['case_staff', 'field_staff', 'internal_staff'];

const revokeActiveSessionsForUser = async (userId: number, executor: QueryExecutor) => {
  const revokeResult = await executeStatement<ResultSetHeader>(
    `UPDATE user_sessions
        SET revoked_at = UTC_TIMESTAMP(6),
            updated_at = UTC_TIMESTAMP(6)
      WHERE user_id = ?
        AND revoked_at IS NULL`,
    [userId],
    executor
  );

  return revokeResult.affectedRows > 0;
};

const disableLoginForUser = async (userId: number, executor: QueryExecutor) => {
  const disableResult = await executeStatement<ResultSetHeader>(
    `UPDATE users
        SET login_enabled = 0,
            updated_at = UTC_TIMESTAMP(6),
            row_version = row_version + 1
      WHERE id = ?
        AND login_enabled <> 0`,
    [userId],
    executor
  );
  const revokedSessions = await revokeActiveSessionsForUser(userId, executor);

  return {
    loginDisabled: disableResult.affectedRows > 0,
    revokedSessions,
  };
};

const disableCounselPartnerLogin = async (counselPartnerId: number, executor: QueryExecutor) => {
  const disableResult = await executeStatement<ResultSetHeader>(
    `UPDATE counsel_partner_users cpu
     INNER JOIN users u ON u.id = cpu.user_id
        SET cpu.relationship_status_code = 'inactive',
            cpu.updated_at = UTC_TIMESTAMP(6),
            u.login_enabled = 0,
            u.updated_at = UTC_TIMESTAMP(6),
            u.row_version = u.row_version + 1
      WHERE cpu.counsel_partner_id = ?
        AND cpu.archived_at IS NULL
        AND (u.login_enabled <> 0 OR COALESCE(cpu.relationship_status_code, '') <> 'inactive')`,
    [counselPartnerId],
    executor
  );
  const revokeResult = await executeStatement<ResultSetHeader>(
    `UPDATE user_sessions us
     INNER JOIN counsel_partner_users cpu ON cpu.user_id = us.user_id
        SET us.revoked_at = UTC_TIMESTAMP(6),
            us.updated_at = UTC_TIMESTAMP(6)
      WHERE cpu.counsel_partner_id = ?
        AND us.revoked_at IS NULL`,
    [counselPartnerId],
    executor
  );

  return {
    loginDisabled: disableResult.affectedRows > 0,
    revokedSessions: revokeResult.affectedRows > 0,
  };
};

const mapStaff = (row: StaffRegistryRow) => ({
  active: row.employmentStatusCode === 'active',
  assignmentCount: Number(row.assignmentCount || 0),
  city: row.city || '',
  country: 'IN',
  email: row.email.includes('@staff.local.globallmg') ? '' : row.email,
  id: row.id,
  loginConfigured:
    Boolean(row.loginEnabled) ||
    Number(row.hasCredentials || 0) > 0 ||
    Number(row.activeRoleCount || 0) > 0,
  loginEnabled: Boolean(row.loginEnabled),
  loginUserId: row.loginUserId,
  name: row.name,
  phone: row.phone || '',
  specialization: row.specialization || '',
  state: row.state || '',
  type: 'internal_staff' as const,
});

const mapCounsel = (row: CounselRegistryRow) => ({
  active: Boolean(row.active),
  assignmentCount: Number(row.assignmentCount || 0),
  city: row.city || '',
  country: row.country || 'IN',
  email: row.email || '',
  id: row.id,
  loginConfigured:
    Boolean(row.loginEnabled) ||
    Boolean(row.loginUserId) ||
    Number(row.hasCredentials || 0) > 0 ||
    Number(row.activeRoleCount || 0) > 0,
  loginEnabled: Boolean(row.loginEnabled),
  loginUserId: row.loginUserId || '',
  name: row.name,
  phone: row.phone || '',
  specialization: row.specialization || '',
  state: row.state || '',
  type: row.type || ('external_counsel' as const),
});

export const getTeamRegistry = async (actor?: AdminActor) => {
  const canView = !actor || actor.permissionCodes.includes('counsel_partner.view') || actor.permissionCodes.includes('settings.manage');
  const canManage = Boolean(actor?.permissionCodes.includes('counsel_partner.manage'));

  if (!canView) {
    return { canManage: false, members: [] };
  }

  const [staffRows, counselRows] = await Promise.all([
    queryRows<StaffRegistryRow>(
      `SELECT
         u.public_id AS id,
         u.public_id AS loginUserId,
         u.display_name AS name,
         u.email,
         u.phone,
         u.login_enabled AS loginEnabled,
         CASE WHEN uc.user_id IS NULL THEN 0 ELSE 1 END AS hasCredentials,
         sp.job_title AS specialization,
         sp.employment_status_code AS employmentStatusCode,
         sp.city,
         sp.state,
         COUNT(DISTINCT ma.id) AS assignmentCount,
         COUNT(DISTINCT CASE
           WHEN ur.role_code <> 'client'
            AND ur.is_active = 1
            AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
            AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
           THEN ur.role_code
         END) AS activeRoleCount
       FROM staff_profiles sp
       INNER JOIN users u ON u.id = sp.user_id
       LEFT JOIN user_credentials uc ON uc.user_id = u.id
       LEFT JOIN user_roles ur
         ON ur.user_id = u.id
       LEFT JOIN matter_assignments ma
         ON ma.internal_user_id = u.id
        AND ma.removed_at IS NULL
        AND ma.assignment_status_code = 'active'
       WHERE u.archived_at IS NULL
         AND u.actor_type_code <> 'client'
         AND NOT EXISTS (
           SELECT 1
           FROM user_roles admin_role
           WHERE admin_role.user_id = u.id
             AND admin_role.is_active = 1
             AND (admin_role.starts_at IS NULL OR admin_role.starts_at <= UTC_TIMESTAMP(6))
             AND (admin_role.ends_at IS NULL OR admin_role.ends_at >= UTC_TIMESTAMP(6))
             AND admin_role.role_code NOT IN (?, ?, ?)
         )
       GROUP BY
         u.public_id,
         u.login_enabled,
         u.display_name,
         u.email,
         u.phone,
         uc.user_id,
         sp.job_title,
         sp.employment_status_code,
         sp.city,
         sp.state
       ORDER BY u.display_name ASC`,
      TEAM_REGISTRY_STAFF_ROLE_CODES
    ),
    queryRows<CounselRegistryRow>(
      `SELECT
         cp.public_id AS id,
         linked_user.public_id AS loginUserId,
         linked_user.login_enabled AS loginEnabled,
         CASE WHEN uc.user_id IS NULL THEN 0 ELSE 1 END AS hasCredentials,
         COALESCE(cp.partner_type_code, 'external_counsel') AS type,
         cp.full_name AS name,
         cp.email,
         cp.phone,
         COALESCE(cp.specialization_text, cp.primary_jurisdiction) AS specialization,
         cp.city,
         cp.state,
         cp.country_code AS country,
         CASE WHEN cp.archived_at IS NULL AND cp.partner_status_code = 'active' THEN 1 ELSE 0 END AS active,
         COUNT(DISTINCT ma.id) AS assignmentCount,
         COUNT(DISTINCT CASE
           WHEN ur.role_code <> 'client'
            AND ur.is_active = 1
            AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
            AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
           THEN ur.role_code
         END) AS activeRoleCount
       FROM counsel_partners cp
       LEFT JOIN counsel_partner_users cpu
         ON cpu.counsel_partner_id = cp.id
        AND cpu.archived_at IS NULL
       LEFT JOIN users linked_user
         ON linked_user.id = cpu.user_id
        AND linked_user.archived_at IS NULL
       LEFT JOIN user_credentials uc ON uc.user_id = linked_user.id
       LEFT JOIN user_roles ur ON ur.user_id = linked_user.id
       LEFT JOIN matter_assignments ma
         ON ma.counsel_partner_id = cp.id
        AND ma.removed_at IS NULL
        AND ma.assignment_status_code = 'active'
       GROUP BY
         cp.public_id,
         linked_user.public_id,
         linked_user.login_enabled,
         uc.user_id,
         cp.partner_type_code,
         cp.full_name,
         cp.email,
         cp.phone,
         cp.specialization_text,
         cp.primary_jurisdiction,
         cp.city,
         cp.state,
         cp.country_code,
         cp.archived_at,
         cp.partner_status_code
       ORDER BY cp.archived_at IS NULL DESC, cp.full_name ASC`
    ),
  ]);

  return {
    canManage,
    members: [...staffRows.map(mapStaff), ...counselRows.map(mapCounsel)],
  };
};

const getStaffDetail = async (memberId: string, executor?: QueryExecutor) =>
  firstRow(
    await queryRows<StaffDetailRow>(
      `SELECT
         u.id AS dbId,
         u.public_id AS id,
         u.display_name AS name,
         u.email,
         u.phone,
         u.account_status_code AS accountStatusCode,
         u.login_enabled AS loginEnabled,
         sp.employment_status_code AS employmentStatusCode,
         CASE WHEN uc.user_id IS NULL THEN 0 ELSE 1 END AS hasCredentials,
         COUNT(DISTINCT CASE
           WHEN ur.role_code <> 'client'
            AND ur.is_active = 1
            AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
            AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
           THEN ur.role_code
         END) AS activeRoleCount
       FROM staff_profiles sp
       INNER JOIN users u ON u.id = sp.user_id
       LEFT JOIN user_credentials uc ON uc.user_id = u.id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.public_id = ?
         AND u.archived_at IS NULL
       GROUP BY
         u.id,
         u.public_id,
         u.display_name,
         u.email,
         u.phone,
         u.account_status_code,
         u.login_enabled,
         sp.employment_status_code,
         uc.user_id
       LIMIT 1`,
      [memberId],
      executor
    )
  );

const getCounselDetail = async (memberId: string, executor?: QueryExecutor) =>
  firstRow(
    await queryRows<CounselDetailRow>(
      `SELECT
         cp.id AS dbId,
         cp.public_id AS id,
         COALESCE(cp.partner_type_code, 'external_counsel') AS type,
         cp.full_name AS name,
         cp.email,
         cp.phone,
         cp.partner_status_code AS partnerStatusCode,
         cp.invited_user_id AS invitedUserId,
         cpu.relationship_status_code AS relationshipStatusCode,
         linked_user.id AS linkedUserDbId,
         linked_user.public_id AS linkedUserId,
         linked_user.login_enabled AS linkedLoginEnabled,
         CASE WHEN uc.user_id IS NULL THEN 0 ELSE 1 END AS hasCredentials,
         COUNT(DISTINCT CASE
           WHEN ur.role_code <> 'client'
            AND ur.is_active = 1
            AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
            AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
           THEN ur.role_code
         END) AS activeRoleCount
       FROM counsel_partners cp
       LEFT JOIN counsel_partner_users cpu
         ON cpu.counsel_partner_id = cp.id
        AND cpu.archived_at IS NULL
       LEFT JOIN users linked_user
         ON linked_user.id = cpu.user_id
        AND linked_user.archived_at IS NULL
       LEFT JOIN user_credentials uc ON uc.user_id = linked_user.id
       LEFT JOIN user_roles ur ON ur.user_id = linked_user.id
       WHERE cp.public_id = ?
       GROUP BY
         cp.id,
         cp.public_id,
         cp.partner_type_code,
         cp.full_name,
         cp.email,
         cp.phone,
         cp.partner_status_code,
         cp.invited_user_id,
         cpu.relationship_status_code,
         linked_user.id,
         linked_user.public_id,
         linked_user.login_enabled,
         uc.user_id
       LIMIT 1`,
      [memberId],
      executor
    )
  );

const getTeamMember = async (memberId: string, executor?: QueryExecutor) => {
  const staff = await getStaffDetail(memberId, executor);
  if (staff) {
    return { dbId: staff.dbId, type: 'internal_staff' as const };
  }

  const counsel = await getCounselDetail(memberId, executor);
  if (counsel) {
    return { dbId: counsel.dbId, type: counsel.type || ('external_counsel' as const) };
  }

  throw notFound('team_member_not_found', 'Team registry entry not found.');
};

const fetchRoleForLogin = async (roleCode: string, executor: QueryExecutor) => {
  const rows = await queryRows<RoleRow>(
    `SELECT code, name, is_active AS isActive
     FROM roles
     WHERE code = ?
     LIMIT 1`,
    [roleCode],
    executor
  );

  return rows[0] || null;
};

const defaultLoginRoleForTeamMember = (type: TeamMemberType) => {
  if (type === 'internal_staff') {
    return 'case_staff';
  }

  if (type === 'external_counsel') {
    return 'advocate';
  }

  throw badRequest('field_partner_login_not_enabled', 'Field partner login is not enabled yet.');
};

const assertAllowedLoginRoleForTeamMember = (type: TeamMemberType, roleCode: string) => {
  if (type === 'internal_staff' && roleCode !== 'case_staff') {
    throw badRequest('team_member_login_role_invalid', 'Internal staff login must use the Case Staff role.');
  }

  if (type === 'external_counsel' && roleCode !== 'advocate') {
    throw badRequest('team_member_login_role_invalid', 'External counsel login must use the Advocate role.');
  }

  if (type === 'field_partner') {
    throw badRequest('field_partner_login_not_enabled', 'Field partner login is not enabled yet.');
  }
};

const buildSetupEmailText = (input: {
  code: string;
  displayName: string;
  expiresAt: Date;
  resetToken: string;
}) => {
  const resetUrl = new URL('/login', env.PUBLIC_ADMIN_WEB_ORIGIN);
  resetUrl.searchParams.set('resetToken', input.resetToken);

  return [
    `Hello ${input.displayName},`,
    '',
    'An administrator enabled your Global LMG admin-panel login.',
    'Use this one-time code to set your password:',
    '',
    input.code,
    '',
    `Setup link: ${resetUrl.toString()}`,
    `This code expires at ${input.expiresAt.toISOString()}.`,
    'If you were not expecting this account, contact a Global LMG ops administrator.',
  ].join('\n');
};

const deliverSetupEmail = async (input: {
  code: string;
  displayName: string;
  email: string;
  expiresAt: Date;
  resetToken: string;
  sendSetupEmail: boolean;
}): Promise<{ providerReference?: string; setupEmailStatus: SetupEmailStatus }> => {
  if (!input.sendSetupEmail) {
    return { setupEmailStatus: 'manual_required' };
  }

  if (env.EMAIL_PROVIDER_MODE === 'disabled') {
    return { setupEmailStatus: 'skipped_provider_disabled' };
  }

  const result = await sendEmail({
    subject: 'Set up your Global LMG admin-panel login',
    text: buildSetupEmailText(input),
    to: input.email,
  });

  if (result.status === 'sent') {
    return { providerReference: result.providerReference, setupEmailStatus: 'sent' };
  }

  if (result.status === 'preview') {
    return { providerReference: result.providerReference, setupEmailStatus: 'preview' };
  }

  return { providerReference: result.providerReference, setupEmailStatus: 'failed' };
};

export const createTeamMember = async (actor: AdminActor, payload: TeamMemberPayload) => {
  const next = normalizePayload(payload);

  return withTransaction(async (connection) => {
    if (next.type === 'internal_staff') {
      await assertUserEmailAvailable(next.email || null, connection);
      const publicId = createPublicId();
      const { firstName, lastName } = splitName(next.name);
      const email = next.email || syntheticStaffEmail(publicId);
      const timezoneName = await getPlatformDefaultTimezone(connection);

      const result = await executeStatement<ResultSetHeader>(
        `INSERT INTO users (
           public_id,
           email,
           phone,
           display_name,
           first_name,
           last_name,
           actor_type_code,
           account_status_code,
           timezone_name,
           locale_code,
           avatar_url,
           login_enabled,
           last_login_at,
           email_verified_at,
           phone_verified_at,
           created_at,
           updated_at,
           archived_at,
           row_version
         ) VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', ?, 'en-US', NULL, 0, NULL, NULL, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, 1)`,
        [publicId, email, next.phone, next.name, firstName, lastName, timezoneName],
        connection
      );

      await executeStatement(
        `INSERT INTO staff_profiles (
           user_id,
           job_title,
           employment_status_code,
           manager_user_id,
           city,
           state
         ) VALUES (?, ?, ?, NULL, ?, ?)`,
        [
          result.insertId,
          next.specialization || 'Coordination Staff',
          next.active ? 'active' : 'inactive',
          next.city,
          next.state,
        ],
        connection
      );

      await createAuditEvent(
        {
          actionCode: 'staff.created',
          actionLabel: 'Internal coordination staff created',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'name', newValue: next.name },
            { fieldName: 'email', newValue: next.email ? '[provided]' : '[not configured]' },
            { fieldName: 'active', newValue: next.active },
          ],
          entityPk: result.insertId,
          entityTableName: 'users',
          sourceModule: 'settings_team_registry',
        },
        connection
      );

      return {
        active: next.active ?? true,
        assignmentCount: 0,
        city: next.city || '',
        country: next.country || 'IN',
        email: next.email || '',
        id: publicId,
        name: next.name,
        phone: next.phone || '',
        specialization: next.specialization || 'Coordination Staff',
        state: next.state || '',
        type: 'internal_staff' as const,
      };
    }

    await assertCounselEmailAvailable(next.email || null, connection);
    const publicId = createPublicId();
    const result = await executeStatement<ResultSetHeader>(
      `INSERT INTO counsel_partners (
         public_id,
         counsel_code,
         full_name,
         organization_name,
         partner_type_code,
         email,
         phone,
         bar_registration_number,
         specialization_text,
         primary_jurisdiction,
         city,
         state,
         country_code,
         years_experience,
         availability_status_code,
         partner_status_code,
         invited_user_id,
         created_at,
         updated_at,
         archived_at,
         row_version
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 'available', ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, 1)`,
      [
        publicId,
        generateCounselCode(next.type, publicId),
        next.name,
        next.type,
        next.email || '',
        next.phone || '',
        next.specialization,
        next.specialization || next.state || next.country || 'Not specified',
        next.city || '',
        next.state || '',
        next.country || 'IN',
        next.active ? 'active' : 'inactive',
      ],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'counsel.created',
        actionLabel: next.type === 'field_partner' ? 'Field partner created' : 'External counsel created',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'name', newValue: next.name },
          { fieldName: 'type', newValue: next.type },
          { fieldName: 'active', newValue: next.active },
        ],
        entityPk: result.insertId,
        entityTableName: 'counsel_partners',
        sourceModule: 'settings_team_registry',
      },
      connection
    );

    return {
      active: next.active ?? true,
      assignmentCount: 0,
      city: next.city || '',
      country: next.country || 'IN',
      email: next.email || '',
      id: publicId,
      name: next.name,
      phone: next.phone || '',
      specialization: next.specialization || '',
      state: next.state || '',
      type: next.type,
    };
  });
};

export const enableTeamMemberLogin = async (
  actor: AdminActor,
  memberId: string,
  payload: EnableTeamMemberLoginPayload = {}
) => {
  if (!actor.permissionCodes.includes('rbac.manage')) {
    throw forbidden('permission_denied', 'You need RBAC management access to enable login.');
  }

  const sendSetupEmail = payload.sendSetupEmail ?? true;
  const requirePasswordRotation = payload.requirePasswordRotation ?? true;

  const result = await withTransaction(async (connection) => {
    const existing = await getTeamMember(memberId, connection);
    const roleCode = normalizeRoleCode(payload.roleCode) || defaultLoginRoleForTeamMember(existing.type);
    assertAllowedLoginRoleForTeamMember(existing.type, roleCode);

    const role = await fetchRoleForLogin(roleCode, connection);
    if (!role || !role.isActive) {
      throw badRequest('team_member_login_role_invalid', 'Choose an active login role.');
    }

    if (!canAssignRoleCode(actor, role.code)) {
      await createAuditEvent(
        {
          actionCode: 'team_member.protected_role_assignment_denied',
          actionLabel: 'Protected team login role assignment denied',
          actorRoleCode: primaryActorRole(actor),
          actorUserId: actor.userId,
          entityPk: existing.dbId,
          entityTableName: existing.type === 'internal_staff' ? 'users' : 'counsel_partners',
          sourceModule: 'settings_team_registry',
          summaryNewValue: { memberId, roleCode: role.code },
        },
        connection
      );
      assertCanAssignRoleCode(actor, role.code);
    }

    let userId = 0;
    let userPublicId = '';
    let displayName = '';
    let email = '';
    let setupTokenPublicId: string | null = null;

    if (existing.type === 'internal_staff') {
      const staff = await getStaffDetail(memberId, connection);
      if (!staff) {
        throw notFound('team_member_not_found', 'Team registry entry not found.');
      }

      if (staff.employmentStatusCode !== 'active' || staff.accountStatusCode !== 'active') {
        throw badRequest('team_member_inactive', 'Activate this staff profile before enabling login.');
      }

      if (!staff.email || isSyntheticStaffEmail(staff.email)) {
        throw badRequest('team_member_email_required', 'Add a real staff email in Team & Counsel before enabling login.');
      }

      if (staff.loginEnabled || Number(staff.hasCredentials || 0) > 0 || Number(staff.activeRoleCount || 0) > 0) {
        throw badRequest('team_member_login_exists', 'This staff member already has login access. Use Admin Users to manage login status.');
      }

      userId = staff.dbId;
      userPublicId = staff.id;
      displayName = staff.name;
      email = staff.email.trim().toLowerCase();

      await executeStatement(
        `UPDATE users
            SET actor_type_code = 'staff',
                email = ?,
                login_enabled = 1,
                email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(6)),
                updated_at = UTC_TIMESTAMP(6),
                row_version = row_version + 1
          WHERE id = ?`,
        [email, userId],
        connection
      );
    } else {
      const counsel = await getCounselDetail(memberId, connection);
      if (!counsel) {
        throw notFound('team_member_not_found', 'Team registry entry not found.');
      }

      if (counsel.partnerStatusCode !== 'active') {
        throw badRequest('team_member_inactive', 'Activate this counsel profile before enabling login.');
      }

      if (!counsel.email?.trim()) {
        throw badRequest('team_member_email_required', 'Add a counsel email in Team & Counsel before enabling login.');
      }

      if (counsel.linkedUserDbId || counsel.invitedUserId) {
        throw badRequest('team_member_login_exists', 'This counsel profile already has linked login access.');
      }

      displayName = counsel.name;
      email = counsel.email.trim().toLowerCase();
      await assertUserEmailAvailable(email, connection);
      const { firstName, lastName } = splitName(displayName);
      const timezoneName = await getPlatformDefaultTimezone(connection);
      userPublicId = createPublicId();
      const userInsert = await executeStatement<ResultSetHeader>(
        `INSERT INTO users (
           public_id,
           email,
           phone,
           display_name,
           first_name,
           last_name,
           actor_type_code,
           account_status_code,
           timezone_name,
           locale_code,
           avatar_url,
           login_enabled,
           last_login_at,
           email_verified_at,
           phone_verified_at,
           created_at,
           updated_at,
           archived_at,
           row_version
         ) VALUES (?, ?, ?, ?, ?, ?, 'counsel', 'active', ?, 'en-US', NULL, 1, NULL, UTC_TIMESTAMP(6), NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL, 1)`,
        [userPublicId, email, counsel.phone || null, displayName, firstName, lastName, timezoneName],
        connection
      );
      userId = userInsert.insertId;

      await executeStatement(
        `INSERT INTO counsel_partner_users (
           public_id,
           counsel_partner_id,
           user_id,
           relationship_status_code,
           created_by_user_id,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 'active', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [createPublicId(), counsel.dbId, userId, actor.userId],
        connection
      );

      await executeStatement(
        `UPDATE counsel_partners
            SET invited_user_id = ?,
                updated_at = UTC_TIMESTAMP(6),
                row_version = row_version + 1
          WHERE id = ?`,
        [userId, counsel.dbId],
        connection
      );
    }

    const unknownTemporaryPassword = createRandomToken(48);
    const passwordHash = await hashPassword(unknownTemporaryPassword);
    await executeStatement(
      `INSERT INTO user_credentials (
         user_id,
         password_hash,
         password_algo,
         password_changed_at,
         must_rotate_password
       ) VALUES (?, ?, 'scrypt', UTC_TIMESTAMP(6), ?)`,
      [userId, passwordHash, requirePasswordRotation ? 1 : 0],
      connection
    );

    await executeStatement(
      `INSERT INTO user_roles (
         user_id,
         role_code,
         is_active,
         granted_by_user_id,
         starts_at,
         created_at,
         updated_at
       ) VALUES (?, ?, 1, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [userId, role.code, actor.userId],
      connection
    );

    await executeStatement(
      `INSERT INTO admin_user_preferences (
         user_id,
         default_landing_path,
         date_format,
         density_code,
         avatar_color,
         in_app_notifications_enabled,
         created_at,
         updated_at
       ) VALUES (?, '/dashboard', 'DD/MM/YYYY', 'comfortable', '#2C2B29', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE updated_at = UTC_TIMESTAMP(6)`,
      [userId],
      connection
    );

    const setupCode = createNumericCode();
    const expiresAt = new Date(Date.now() + TEAM_MEMBER_SETUP_TOKEN_TTL_MINUTES * 60_000);
    setupTokenPublicId = createPublicId();
    await executeStatement(
      `INSERT INTO password_reset_tokens (
         public_id,
         user_id,
         code_hash,
         expires_at,
         sent_at,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        setupTokenPublicId,
        userId,
        hashOpaqueValue(setupCode, env.AUTH_SESSION_SECRET),
        toMysqlDateTime(expiresAt),
      ],
      connection
    );

    await createAuditEvent(
      {
        actionCode: existing.type === 'internal_staff' ? 'staff.login_enabled' : 'counsel.login_enabled',
        actionLabel: existing.type === 'internal_staff' ? 'Staff login enabled' : 'Counsel login enabled',
        actorRoleCode: primaryActorRole(actor),
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'login_enabled', newValue: true },
          { fieldName: 'role_code', newValue: role.code },
        ],
        entityPk: userId,
        entityTableName: 'users',
        sourceModule: 'settings_team_registry',
        summaryNewValue: {
          memberId,
          note: normalizeOptionalText(payload.note),
          roleCode: role.code,
          setupEmailRequested: sendSetupEmail,
        },
      },
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'user_role.assigned',
        actionLabel: 'User role assigned',
        actorRoleCode: primaryActorRole(actor),
        actorUserId: actor.userId,
        changes: [{ fieldName: 'role_code', newValue: role.code }],
        entityPk: userId,
        entityTableName: 'users',
        sourceModule: 'settings_team_registry',
        summaryNewValue: { memberId, roleCode: role.code, userEmail: email },
      },
      connection
    );

    return {
      setupEmail: {
        code: setupCode,
        displayName,
        email,
        expiresAt,
        resetToken: setupTokenPublicId,
        sendSetupEmail,
      },
      user: {
        displayName,
        email,
        id: userPublicId,
        loginEnabled: true,
        requirePasswordRotation,
        roleCodes: [role.code],
        setupTokenCreated: Boolean(setupTokenPublicId),
      },
    };
  });

  const delivery = await deliverSetupEmail(result.setupEmail);
  if (delivery.setupEmailStatus === 'sent') {
    await executeStatement(
      `UPDATE password_reset_tokens
          SET sent_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE public_id = ?`,
      [result.setupEmail.resetToken]
    );
  }

  if (delivery.setupEmailStatus === 'sent') {
    await createAuditEvent({
      actionCode: 'team_member.setup_email_sent',
      actionLabel: 'Team member setup email sent',
      actorRoleCode: primaryActorRole(actor),
      actorUserId: actor.userId,
      entityPk: null,
      entityTableName: 'users',
      sourceModule: 'settings_team_registry',
      summaryNewValue: {
        memberId,
        providerReference: delivery.providerReference,
        userEmail: result.user.email,
      },
    });
  }

  return {
    mfaRequirementMode: await getAdminMfaRequirementMode(),
    setupEmailStatus: delivery.setupEmailStatus,
    status: 'enabled' as const,
    user: {
      ...result.user,
      setupEmailStatus: delivery.setupEmailStatus,
    },
  };
};

export const updateTeamMemberLogin = async (
  actor: AdminActor,
  memberId: string,
  payload: UpdateTeamMemberLoginPayload
) => {
  if (!actor.permissionCodes.includes('rbac.manage')) {
    throw forbidden('permission_denied', 'You need RBAC management access to update login.');
  }

  const result = await withTransaction(async (connection) => {
    const existing = await getTeamMember(memberId, connection);
    const target =
      existing.type === 'internal_staff'
        ? await getStaffDetail(memberId, connection)
        : await getCounselDetail(memberId, connection);

    if (!target) {
      throw notFound('team_member_not_found', 'Team registry entry not found.');
    }

    if (existing.type === 'field_partner') {
      throw badRequest('field_partner_login_not_enabled', 'Field partner login is not enabled yet.');
    }

    const userId =
      existing.type === 'internal_staff'
        ? (target as StaffDetailRow).dbId
        : (target as CounselDetailRow).linkedUserDbId;
    const currentLoginEnabled =
      existing.type === 'internal_staff'
        ? Boolean((target as StaffDetailRow).loginEnabled)
        : Boolean((target as CounselDetailRow).linkedLoginEnabled) &&
          (target as CounselDetailRow).relationshipStatusCode === 'active';

    if (!userId) {
      throw badRequest(
        'team_member_login_not_configured',
        'Enable login for this Team & Counsel profile before changing login status.'
      );
    }

    if (payload.loginEnabled) {
      const hasCredentials =
        existing.type === 'internal_staff'
          ? Number((target as StaffDetailRow).hasCredentials || 0) > 0
          : Number((target as CounselDetailRow).hasCredentials || 0) > 0;
      const hasRole =
        existing.type === 'internal_staff'
          ? Number((target as StaffDetailRow).activeRoleCount || 0) > 0
          : Number((target as CounselDetailRow).activeRoleCount || 0) > 0;

      if (!hasCredentials || !hasRole) {
        throw badRequest(
          'team_member_login_not_configured',
          'This profile does not have complete login setup. Enable login from the profile first.'
        );
      }

      if (existing.type === 'internal_staff') {
        const staff = target as StaffDetailRow;
        if (staff.employmentStatusCode !== 'active' || staff.accountStatusCode !== 'active') {
          throw badRequest('team_member_inactive', 'Activate this staff profile before enabling login.');
        }
      } else {
        const counsel = target as CounselDetailRow;
        if (counsel.partnerStatusCode !== 'active') {
          throw badRequest('team_member_inactive', 'Activate this counsel profile before enabling login.');
        }
      }
    }

    if (!payload.loginEnabled && userId === actor.userId) {
      throw forbidden('self_deactivation_blocked', 'You cannot disable your own login.');
    }

    if (currentLoginEnabled === payload.loginEnabled) {
      return { changed: false, userId };
    }

    await executeStatement(
      `UPDATE users
          SET login_enabled = ?,
              account_status_code = CASE WHEN ? = 1 THEN 'active' ELSE account_status_code END,
              updated_at = UTC_TIMESTAMP(6),
              row_version = row_version + 1
        WHERE id = ?`,
      [payload.loginEnabled ? 1 : 0, payload.loginEnabled ? 1 : 0, userId],
      connection
    );

    if (existing.type !== 'internal_staff') {
      await executeStatement(
        `UPDATE counsel_partner_users
            SET relationship_status_code = ?,
                updated_at = UTC_TIMESTAMP(6)
          WHERE user_id = ?
            AND archived_at IS NULL`,
        [payload.loginEnabled ? 'active' : 'inactive', userId],
        connection
      );
    }

    let revokedSessions = false;
    if (!payload.loginEnabled) {
      revokedSessions = await revokeActiveSessionsForUser(userId, connection);
    }

    await createAuditEvent(
      {
        actionCode: payload.loginEnabled ? 'team_member.login_reenabled' : 'team_member.login_disabled',
        actionLabel: payload.loginEnabled ? 'Team member login re-enabled' : 'Team member login disabled',
        actorRoleCode: primaryActorRole(actor),
        actorUserId: actor.userId,
        changes: [
          { fieldName: 'login_enabled', oldValue: currentLoginEnabled, newValue: payload.loginEnabled },
          ...(payload.loginEnabled ? [] : [{ fieldName: 'sessions_revoked', newValue: revokedSessions }]),
        ],
        entityPk: userId,
        entityTableName: 'users',
        sourceModule: 'settings_team_registry',
        summaryNewValue: { memberId, loginEnabled: payload.loginEnabled, revokedSessions },
      },
      connection
    );

    return { changed: true, revokedSessions, userId };
  });

  return {
    id: memberId,
    loginEnabled: payload.loginEnabled,
    sessionsRevoked: result.revokedSessions ?? false,
    status: result.changed ? 'updated' : 'unchanged',
  };
};

export const updateTeamMember = async (
  actor: AdminActor,
  memberId: string,
  payload: UpdateTeamMemberPayload
) => {
  return withTransaction(async (connection) => {
    const existing = await getTeamMember(memberId, connection);
    const currentRegistry = await getTeamRegistry(actor);
    const current = currentRegistry.members.find((member) => member.id === memberId);

    if (!current) {
      throw notFound('team_member_not_found', 'Team registry entry not found.');
    }

    const next = normalizePayload({
      active: payload.active ?? current.active,
      city: payload.city === undefined ? current.city : payload.city,
      country: payload.country === undefined ? current.country : payload.country,
      email: payload.email === undefined ? current.email : payload.email,
      name: payload.name ?? current.name,
      phone: payload.phone === undefined ? current.phone : payload.phone,
      specialization: payload.specialization === undefined ? current.specialization : payload.specialization,
      state: payload.state === undefined ? current.state : payload.state,
      type: existing.type,
    });

    if (existing.type === 'internal_staff') {
      if (!next.active && current.active && existing.dbId === actor.userId) {
        throw forbidden('self_deactivation_blocked', 'You cannot deactivate your own staff registry entry.');
      }

      await assertUserEmailAvailable(next.email || null, connection, existing.dbId);
      const { firstName, lastName } = splitName(next.name);
      const email = next.email || current.email || syntheticStaffEmail(memberId);
      let loginDisabled = false;
      let revokedSessions = false;

      await executeStatement(
        `UPDATE users
         SET display_name = ?,
             first_name = ?,
             last_name = ?,
             email = ?,
             phone = ?,
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [next.name, firstName, lastName, email, next.phone, existing.dbId],
        connection
      );
      await executeStatement(
        `UPDATE staff_profiles
         SET job_title = ?,
             employment_status_code = ?,
             city = ?,
             state = ?
         WHERE user_id = ?`,
        [
          next.specialization || 'Coordination Staff',
          next.active ? 'active' : 'inactive',
          next.city,
          next.state,
          existing.dbId,
        ],
        connection
      );

      if (current.active && !next.active) {
        const disableResult = await disableLoginForUser(existing.dbId, connection);
        loginDisabled = disableResult.loginDisabled;
        revokedSessions = disableResult.revokedSessions;
      }

      await createAuditEvent(
        {
          actionCode: 'staff.updated',
          actionLabel: 'Internal coordination staff updated',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'name', oldValue: current.name, newValue: next.name },
            { fieldName: 'active', oldValue: current.active, newValue: next.active },
            ...(current.active && !next.active
              ? [
                  { fieldName: 'login_disabled', newValue: loginDisabled },
                  { fieldName: 'sessions_revoked', newValue: revokedSessions },
                ]
              : []),
          ],
          entityPk: existing.dbId,
          entityTableName: 'users',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    } else {
      await assertCounselEmailAvailable(next.email || null, connection, existing.dbId);
      let loginDisabled = false;
      let revokedSessions = false;

      await executeStatement(
        `UPDATE counsel_partners
         SET full_name = ?,
             partner_type_code = ?,
             email = ?,
             phone = ?,
             specialization_text = ?,
             primary_jurisdiction = ?,
             city = ?,
             state = ?,
             country_code = ?,
             partner_status_code = ?,
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [
          next.name,
          existing.type,
          next.email || '',
          next.phone || '',
          next.specialization,
          next.specialization || next.state || next.country || 'Not specified',
          next.city || '',
          next.state || '',
          next.country || 'IN',
          next.active ? 'active' : 'inactive',
          existing.dbId,
        ],
        connection
      );

      if (current.active && !next.active) {
        const disableResult = await disableCounselPartnerLogin(existing.dbId, connection);
        loginDisabled = disableResult.loginDisabled;
        revokedSessions = disableResult.revokedSessions;
      }

      await createAuditEvent(
        {
          actionCode: 'counsel.updated',
          actionLabel: existing.type === 'field_partner' ? 'Field partner updated' : 'External counsel updated',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          changes: [
            { fieldName: 'name', oldValue: current.name, newValue: next.name },
            { fieldName: 'active', oldValue: current.active, newValue: next.active },
            ...(current.active && !next.active
              ? [
                  { fieldName: 'login_disabled', newValue: loginDisabled },
                  { fieldName: 'sessions_revoked', newValue: revokedSessions },
                ]
              : []),
          ],
          entityPk: existing.dbId,
          entityTableName: 'counsel_partners',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    }

    return {
      active: next.active ?? true,
      assignmentCount: current.assignmentCount,
      city: next.city || '',
      country: next.country || 'IN',
      email: next.email || '',
      id: memberId,
      name: next.name,
      phone: next.phone || '',
      specialization: next.specialization || '',
      state: next.state || '',
      type: existing.type,
    };
  });
};

export const archiveTeamMember = async (actor: AdminActor, memberId: string) => {
  return withTransaction(async (connection) => {
    const existing = await getTeamMember(memberId, connection);

    if (existing.type === 'internal_staff') {
      if (existing.dbId === actor.userId) {
        throw badRequest('cannot_archive_self', 'You cannot archive your own staff registry entry.');
      }

      await executeStatement(
        `UPDATE staff_profiles
         SET employment_status_code = 'archived'
         WHERE user_id = ?`,
        [existing.dbId],
        connection
      );
      await executeStatement(
        `UPDATE users
         SET login_enabled = 0,
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [existing.dbId],
        connection
      );
      await executeStatement(
        `UPDATE user_sessions
         SET revoked_at = UTC_TIMESTAMP(6),
             updated_at = UTC_TIMESTAMP(6)
         WHERE user_id = ?
           AND revoked_at IS NULL`,
        [existing.dbId],
        connection
      );
      await createAuditEvent(
        {
          actionCode: 'staff.archived',
          actionLabel: 'Internal coordination staff archived',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          entityPk: existing.dbId,
          entityTableName: 'users',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    } else {
      await executeStatement(
        `UPDATE counsel_partners
         SET archived_at = COALESCE(archived_at, UTC_TIMESTAMP(6)),
             partner_status_code = 'inactive',
             updated_at = UTC_TIMESTAMP(6),
             row_version = row_version + 1
         WHERE id = ?`,
        [existing.dbId],
        connection
      );
      await executeStatement(
        `UPDATE counsel_partner_users cpu
         INNER JOIN users u ON u.id = cpu.user_id
         SET cpu.relationship_status_code = 'inactive',
             cpu.updated_at = UTC_TIMESTAMP(6),
             u.login_enabled = 0,
             u.updated_at = UTC_TIMESTAMP(6),
             u.row_version = u.row_version + 1
         WHERE cpu.counsel_partner_id = ?
           AND cpu.archived_at IS NULL`,
        [existing.dbId],
        connection
      );
      await executeStatement(
        `UPDATE user_sessions us
         INNER JOIN counsel_partner_users cpu ON cpu.user_id = us.user_id
         SET us.revoked_at = UTC_TIMESTAMP(6),
             us.updated_at = UTC_TIMESTAMP(6)
         WHERE cpu.counsel_partner_id = ?
           AND us.revoked_at IS NULL`,
        [existing.dbId],
        connection
      );
      await createAuditEvent(
        {
          actionCode: 'counsel.archived',
          actionLabel: existing.type === 'field_partner' ? 'Field partner archived' : 'External counsel archived',
          actorRoleCode: actor.roleCodes[0] || 'ops_admin',
          actorUserId: actor.userId,
          entityPk: existing.dbId,
          entityTableName: 'counsel_partners',
          sourceModule: 'settings_team_registry',
        },
        connection
      );
    }

    return { id: memberId, status: 'archived' as const };
  });
};
