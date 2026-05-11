import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { createNumericCode, createPublicId, createRandomToken, hashOpaqueValue, hashPassword } from '../../lib/authCrypto.js';
import { badRequest, forbidden } from '../../lib/httpErrors.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import type { AdminActor } from '../auth/service.js';
import { assertCanAssignRoleCode, canAssignRoleCode } from '../rbac/protectedRoles.js';
import { sendEmail } from '../providers/email.js';
import { createAuditEvent } from '../writeSupport.js';
import { getAdminMfaRequirementMode, getPlatformDefaultTimezone } from './platformSettings.js';

type ExistingUserRow = RowDataPacket & {
  actorTypeCode: string;
  archivedAt: string | null;
  email: string;
  id: number;
  loginEnabled: number;
};

type RoleRow = RowDataPacket & {
  code: string;
  isActive: number;
  isSystem: number;
  name: string;
};

type ProvisionedAdminUserRow = RowDataPacket & {
  actorTypeCode: string;
  displayName: string;
  email: string;
  hasCredentials: number;
  id: number;
  loginEnabled: number;
  publicId: string;
  roleCodes: string | null;
};

type CreateAdminUserPayload = {
  active?: boolean;
  city?: string | null;
  counselPartnerId?: string | null;
  displayName: string;
  email: string;
  jobTitle?: string | null;
  loginEnabled?: boolean;
  note?: string | null;
  phone?: string | null;
  provisioningKind?: 'admin' | 'advocate' | 'billing_staff' | 'internal_staff';
  requirePasswordRotation?: boolean;
  roleCode: string;
  sendSetupEmail?: boolean;
  staffProfileUserId?: string | null;
  state?: string | null;
};

type UpdateAdminUserPayload = {
  active?: boolean;
  loginEnabled?: boolean;
};

type SetupEmailStatus =
  | 'failed'
  | 'manual_required'
  | 'preview'
  | 'sent'
  | 'skipped_login_disabled'
  | 'skipped_provider_disabled';

const ADMIN_SETUP_TOKEN_TTL_MINUTES = 30;
const ADMIN_USER_CREATE_BLOCKED_ROLE_CODES = new Set([
  'advocate',
  'billing_admin',
  'billing_staff',
  'case_staff',
  'client',
  'field_staff',
  'internal_staff',
]);
const normalizeEmail = (value: string) => value.trim().toLowerCase();

const optionalText = (value: string | null | undefined) => {
  const trimmed = value?.trim() || '';
  return trimmed || null;
};

const toMysqlDateTime = (date: Date) => date.toISOString().slice(0, 23).replace('T', ' ');

const primaryActorRole = (actor: AdminActor) => actor.roleCodes[0] || 'ops_admin';

const splitDisplayName = (displayName: string) => {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || displayName.trim();
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { firstName, lastName };
};

const fetchRoleForProvisioning = async (roleCode: string, executor: QueryExecutor) => {
  const rows = await queryRows<RoleRow>(
    `SELECT code, name, is_active AS isActive, is_system AS isSystem
     FROM roles
     WHERE code = ?
     LIMIT 1`,
    [roleCode],
    executor
  );
  return rows[0] || null;
};

const fetchExistingUserByEmail = async (email: string, executor: QueryExecutor, excludeUserId?: number | null) => {
  const rows = await queryRows<ExistingUserRow>(
    `SELECT
       id,
       email,
       actor_type_code AS actorTypeCode,
       login_enabled AS loginEnabled,
       archived_at AS archivedAt
     FROM users
     WHERE LOWER(email) = ?
       AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [email, excludeUserId ?? null, excludeUserId ?? null],
    executor
  );
  return rows[0] || null;
};

const fetchProvisionedAdminUser = async (userPublicId: string, executor: QueryExecutor) => {
  const rows = await queryRows<ProvisionedAdminUserRow>(
    `SELECT
       u.id,
       u.public_id AS publicId,
       u.display_name AS displayName,
       u.email,
       u.actor_type_code AS actorTypeCode,
       u.login_enabled AS loginEnabled,
       CASE WHEN uc.user_id IS NULL THEN 0 ELSE 1 END AS hasCredentials,
       GROUP_CONCAT(DISTINCT ur.role_code ORDER BY ur.role_code) AS roleCodes
     FROM users u
     LEFT JOIN user_credentials uc ON uc.user_id = u.id
     LEFT JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
     WHERE u.public_id = ?
       AND u.archived_at IS NULL
     GROUP BY u.id, u.public_id, u.display_name, u.email, u.actor_type_code, u.login_enabled, uc.user_id
     LIMIT 1`,
    [userPublicId],
    executor
  );

  return rows[0] || null;
};

const activeOpsAdminCount = async (executor: QueryExecutor) => {
  const rows = await queryRows<RowDataPacket & { countValue: number }>(
    `SELECT COUNT(DISTINCT u.id) AS countValue
     FROM users u
     JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.role_code = 'ops_admin'
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
     JOIN roles r
       ON r.code = ur.role_code
      AND r.is_active = 1
     WHERE u.archived_at IS NULL
       AND u.login_enabled = 1
       AND u.account_status_code = 'active'`,
    [],
    executor
  );

  return Number(rows[0]?.countValue || 0);
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
    'An administrator created a Global LMG admin account for you.',
    'Use this one-time code to set your admin password:',
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
    subject: 'Set up your Global LMG admin account',
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

const recordProvisioningAudit = async (
  actor: AdminActor,
  input: {
    actionCode: string;
    actionLabel: string;
    changes?: Array<{ fieldName: string; newValue?: unknown; oldValue?: unknown }>;
    entityPk: number;
    summaryNewValue?: Record<string, unknown>;
  },
  executor: QueryExecutor
) => {
  await createAuditEvent(
    {
      actionCode: input.actionCode,
      actionLabel: input.actionLabel,
      actorRoleCode: primaryActorRole(actor),
      actorUserId: actor.userId,
      changes: input.changes || [],
      entityPk: input.entityPk,
      entityTableName: 'users',
      sourceModule: 'admin_user_provisioning',
      summaryNewValue: input.summaryNewValue || {},
    },
    executor
  );
};

export const createAdminUser = async (actor: AdminActor, payload: CreateAdminUserPayload) => {
  if (!actor.permissionCodes.includes('rbac.manage')) {
    throw forbidden('permission_denied', 'You need RBAC management access to create admin users.');
  }

  const email = normalizeEmail(payload.email);
  const roleCode = payload.roleCode.trim();
  let displayName = payload.displayName.trim();
  const provisioningKind = payload.provisioningKind || 'admin';
  const loginEnabled = payload.loginEnabled ?? payload.active ?? true;
  const requirePasswordRotation = payload.requirePasswordRotation ?? true;
  const sendSetupEmail = payload.sendSetupEmail ?? true;

  if (provisioningKind !== 'admin') {
    throw badRequest(
      'admin_user_provisioning_kind_unsupported',
      'Create staff and counsel profiles in Team & Counsel first, then enable login from the profile workflow.'
    );
  }

  if (optionalText(payload.staffProfileUserId) || optionalText(payload.counselPartnerId)) {
    throw badRequest(
      'admin_user_profile_link_not_allowed',
      'Admin Users can only create admin login accounts. Staff and counsel login access must start from Team & Counsel.'
    );
  }

  if (ADMIN_USER_CREATE_BLOCKED_ROLE_CODES.has(roleCode)) {
    throw badRequest(
      'admin_user_role_invalid',
      'This role is not available in the New Admin flow.'
    );
  }

  const result = await withTransaction(async (connection) => {
    const role = await fetchRoleForProvisioning(roleCode, connection);
    if (!role || !role.isActive) {
      throw badRequest('admin_user_role_invalid', 'Choose an active admin role.');
    }

    if (role.code === 'client') {
      throw badRequest('admin_user_role_invalid', 'Client portal roles cannot be assigned to admin users.');
    }
    if (!canAssignRoleCode(actor, role.code)) {
      await createAuditEvent({
        actionCode: 'admin.protected_role_assignment_denied',
        actionLabel: 'Protected admin user role assignment denied',
        actorRoleCode: primaryActorRole(actor),
        actorUserId: actor.userId,
        entityPk: null,
        entityTableName: 'users',
        sourceModule: 'admin_user_provisioning',
        summaryNewValue: {
          email,
          roleCode: role.code,
        },
      });
      assertCanAssignRoleCode(actor, role.code);
    }

    const existingUser = await fetchExistingUserByEmail(email, connection, null);
    if (existingUser) {
      throw badRequest('admin_user_email_exists', 'An account already exists for this email address.');
    }

    const { firstName, lastName } = splitDisplayName(displayName);
    const timezoneName = await getPlatformDefaultTimezone(connection);
    const userPublicId = createPublicId();
    const userInsert = await executeStatement<ResultSetHeader>(
      `INSERT INTO users (
         public_id,
         actor_type_code,
         email,
         phone,
         display_name,
         first_name,
         last_name,
         timezone_name,
         locale_code,
         account_status_code,
         login_enabled,
         email_verified_at,
         created_at,
         updated_at
       ) VALUES (?, 'admin', ?, ?, ?, ?, ?, ?, 'en-US', 'active', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        userPublicId,
        email,
        optionalText(payload.phone),
        displayName,
        firstName,
        lastName,
        timezoneName,
        loginEnabled ? 1 : 0,
      ],
      connection
    );
    const userId = userInsert.insertId;

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

    let setupEmail:
      | {
          code: string;
          displayName: string;
          email: string;
          expiresAt: Date;
          resetToken: string;
          sendSetupEmail: boolean;
        }
      | null = null;
    let setupTokenPublicId: string | null = null;
    if (loginEnabled) {
      setupTokenPublicId = createPublicId();
      const setupCode = createNumericCode();
      const expiresAt = new Date(Date.now() + ADMIN_SETUP_TOKEN_TTL_MINUTES * 60_000);
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

      setupEmail = {
        code: setupCode,
        displayName,
        email,
        expiresAt,
        resetToken: setupTokenPublicId,
        sendSetupEmail,
      };
    }

    await recordProvisioningAudit(
      actor,
      {
        actionCode: 'admin.user_created',
        actionLabel: 'Admin user created',
        changes: [
          { fieldName: 'email', newValue: email },
          { fieldName: 'display_name', newValue: displayName },
          { fieldName: 'login_enabled', newValue: loginEnabled },
        ],
        entityPk: userId,
        summaryNewValue: {
          email,
          loginEnabled,
          note: optionalText(payload.note),
          provisioningKind,
          roleCode: role.code,
          setupEmailRequested: loginEnabled && sendSetupEmail,
        },
      },
      connection
    );
    await recordProvisioningAudit(
      actor,
      {
        actionCode: 'user_role.assigned',
        actionLabel: 'User role assigned',
        changes: [{ fieldName: 'role_code', newValue: role.code }],
        entityPk: userId,
        summaryNewValue: {
          roleCode: role.code,
          userEmail: email,
        },
      },
      connection
    );

    return {
      setupEmail,
      user: {
        databaseId: userId,
        id: userPublicId,
        displayName,
        email,
        loginEnabled,
        provisioningKind,
        requirePasswordRotation,
        roleCodes: [role.code],
        setupTokenCreated: Boolean(setupTokenPublicId),
      },
    };
  });

  const delivery = result.setupEmail
    ? await deliverSetupEmail(result.setupEmail)
    : { setupEmailStatus: 'skipped_login_disabled' as const };

  if (result.setupEmail && delivery.setupEmailStatus === 'sent') {
    await executeStatement(
      `UPDATE password_reset_tokens
          SET sent_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE public_id = ?`,
      [result.setupEmail.resetToken]
    );
  }

  await createAuditEvent({
    actionCode:
      delivery.setupEmailStatus === 'sent'
        ? 'admin.setup_email_sent'
        : 'admin.setup_email_skipped',
    actionLabel:
      delivery.setupEmailStatus === 'sent'
        ? 'Admin setup email sent'
        : 'Admin setup email skipped',
    actorRoleCode: primaryActorRole(actor),
    actorUserId: actor.userId,
    entityPk: result.user.databaseId,
    entityTableName: 'users',
    sourceModule: 'admin_user_provisioning',
    summaryNewValue: {
      providerMode: env.EMAIL_PROVIDER_MODE,
      setupEmailStatus: delivery.setupEmailStatus,
    },
  });

  return {
    mfaRequirementMode: await getAdminMfaRequirementMode(),
    message: 'Admin created. They must set a password before signing in.',
    setupEmailStatus: delivery.setupEmailStatus,
    status: 'created' as const,
    user: {
      displayName: result.user.displayName,
      email: result.user.email,
      id: result.user.id,
      loginEnabled: result.user.loginEnabled,
      requirePasswordRotation: result.user.requirePasswordRotation,
      roleCodes: result.user.roleCodes,
      setupTokenCreated: result.user.setupTokenCreated,
      setupEmailStatus: delivery.setupEmailStatus,
    },
  };
};

export const updateAdminUser = async (
  actor: AdminActor,
  userPublicId: string,
  payload: UpdateAdminUserPayload
) => {
  if (!actor.permissionCodes.includes('rbac.manage')) {
    throw forbidden('permission_denied', 'You need RBAC management access to update admin users.');
  }

  const requestedLoginEnabled = payload.loginEnabled ?? payload.active;
  if (requestedLoginEnabled === undefined) {
    throw badRequest('admin_user_update_empty', 'Choose whether admin login should be enabled.');
  }

  const result = await withTransaction(async (connection) => {
    const target = await fetchProvisionedAdminUser(userPublicId.trim(), connection);
    if (!target) {
      throw badRequest('admin_user_not_found', 'Admin user was not found.');
    }

    const roleCodes = (target.roleCodes || '').split(',').filter(Boolean);
    const hasAdminRole = roleCodes.some((roleCode) => roleCode !== 'client');
    if (target.actorTypeCode === 'client' || !hasAdminRole) {
      throw badRequest('admin_user_invalid_target', 'Only non-client admin users can be managed here.');
    }

    if (requestedLoginEnabled && !target.hasCredentials) {
      throw badRequest(
        'admin_user_credentials_missing',
        'This user does not have admin credentials. Create a new admin setup invite instead.'
      );
    }

    const currentLoginEnabled = Boolean(target.loginEnabled);
    if (currentLoginEnabled === requestedLoginEnabled) {
      return {
        changed: false,
        revokedSessions: false,
        target,
      };
    }

    if (!requestedLoginEnabled) {
      if (target.id === actor.userId) {
        throw forbidden('self_deactivation_blocked', 'You cannot disable your own admin login.');
      }

      if (roleCodes.includes('ops_admin') && (await activeOpsAdminCount(connection)) <= 1) {
        throw forbidden('last_ops_admin_blocked', 'The last active ops_admin user cannot be disabled.');
      }
    }

    await executeStatement(
      `UPDATE users
          SET login_enabled = ?,
              account_status_code = CASE WHEN ? = 1 THEN 'active' ELSE account_status_code END,
              updated_at = UTC_TIMESTAMP(6),
              row_version = row_version + 1
        WHERE id = ?`,
      [requestedLoginEnabled ? 1 : 0, requestedLoginEnabled ? 1 : 0, target.id],
      connection
    );

    let revokedSessions = false;
    if (!requestedLoginEnabled) {
      const revokeResult = await executeStatement<ResultSetHeader>(
        `UPDATE user_sessions
            SET revoked_at = UTC_TIMESTAMP(6),
                updated_at = UTC_TIMESTAMP(6)
          WHERE user_id = ?
            AND revoked_at IS NULL`,
        [target.id],
        connection
      );
      revokedSessions = revokeResult.affectedRows > 0;
    }

    await recordProvisioningAudit(
      actor,
      {
        actionCode: requestedLoginEnabled ? 'admin.user_reactivated' : 'admin.user_deactivated',
        actionLabel: requestedLoginEnabled ? 'Admin user reactivated' : 'Admin user deactivated',
        changes: [
          {
            fieldName: 'login_enabled',
            newValue: requestedLoginEnabled,
            oldValue: currentLoginEnabled,
          },
          ...(requestedLoginEnabled ? [] : [{ fieldName: 'sessions_revoked', newValue: revokedSessions }]),
        ],
        entityPk: target.id,
        summaryNewValue: {
          email: target.email,
          loginEnabled: requestedLoginEnabled,
          revokedSessions,
          roleCodes,
        },
      },
      connection
    );

    return {
      changed: true,
      revokedSessions,
      target,
    };
  });

  return {
    status: result.changed ? 'updated' : 'unchanged',
    user: {
      displayName: result.target.displayName,
      email: result.target.email,
      id: result.target.publicId,
      loginEnabled: requestedLoginEnabled,
      roleCodes: (result.target.roleCodes || '').split(',').filter(Boolean),
    },
    sessionsRevoked: result.revokedSessions,
  };
};
