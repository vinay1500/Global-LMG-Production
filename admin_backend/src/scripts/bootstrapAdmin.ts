import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { createPublicId, hashPassword } from '../lib/authCrypto.js';
import { closeMysqlPool, executeStatement, queryRows, withTransaction } from '../lib/mysql.js';
import { logEvent } from '../lib/observability.js';
import { createAuditEvent } from '../modules/writeSupport.js';

type UserRow = RowDataPacket & {
  account_status_code: string;
  archived_at: string | null;
  display_name: string;
  id: number;
  login_enabled: number;
};

type CredentialRow = RowDataPacket & {
  must_rotate_password: number;
  user_id: number;
};

type RoleRow = RowDataPacket & {
  code: string;
};

const BOOTSTRAP_SAFE_ADMIN_ROLE_CODES = new Set(['ops_admin']);

const requireBootstrapEnv = () => {
  if (env.APP_ENV === 'production' && !env.ADMIN_BOOTSTRAP_ENABLED) {
    throw new Error(
      'ADMIN_BOOTSTRAP_ENABLED=true is required to run admin bootstrap in production.'
    );
  }

  if (!env.ADMIN_BOOTSTRAP_EMAIL) {
    throw new Error('ADMIN_BOOTSTRAP_EMAIL is required.');
  }

  if (!env.ADMIN_BOOTSTRAP_PASSWORD) {
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD is required.');
  }

  if (!env.ADMIN_BOOTSTRAP_NAME) {
    throw new Error('ADMIN_BOOTSTRAP_NAME is required.');
  }

  return {
    email: env.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(),
    forceRotation: env.ADMIN_BOOTSTRAP_FORCE_ROTATION,
    name: env.ADMIN_BOOTSTRAP_NAME,
    password: env.ADMIN_BOOTSTRAP_PASSWORD,
    resetPassword: env.ADMIN_BOOTSTRAP_RESET_PASSWORD,
    roleCode: env.ADMIN_BOOTSTRAP_ROLE,
  };
};

const splitDisplayName = (displayName: string) => {
  const parts = displayName.trim().split(/\s+/);
  const firstName = parts.shift() || 'Admin';
  const lastName = parts.length > 0 ? parts.join(' ') : null;

  return { firstName, lastName };
};

const getExistingUser = async (email: string) => {
  const rows = await queryRows<UserRow>(
    `SELECT id, display_name, account_status_code, login_enabled, archived_at
     FROM users
     WHERE LOWER(email) = LOWER(?)
     LIMIT 1`,
    [email]
  );

  return rows[0] || null;
};

const ensureRoleExists = async (roleCode: string) => {
  if (!BOOTSTRAP_SAFE_ADMIN_ROLE_CODES.has(roleCode)) {
    throw new Error(
      `Admin bootstrap role "${roleCode}" is not bootstrap-safe. Use ops_admin for bootstrap and provision operational/scoped roles through the normal admin workflows.`
    );
  }

  const rows = await queryRows<RoleRow>(
    `SELECT code
     FROM roles
     WHERE code = ?
       AND is_active = 1
     LIMIT 1`,
    [roleCode]
  );

  if (!rows[0]) {
    throw new Error(`Admin bootstrap role "${roleCode}" does not exist or is inactive.`);
  }
};

const bootstrapAdmin = async () => {
  const bootstrap = requireBootstrapEnv();
  await ensureRoleExists(bootstrap.roleCode);

  const existingUser = await getExistingUser(bootstrap.email);

  if (existingUser?.archived_at) {
    throw new Error('A user with ADMIN_BOOTSTRAP_EMAIL exists but is archived.');
  }

  const { firstName, lastName } = splitDisplayName(bootstrap.name);
  const passwordHash = await hashPassword(bootstrap.password);

  const result = await withTransaction(async (connection) => {
    let userId = existingUser?.id || null;
    let userCreated = false;

    if (!userId) {
      const insertResult = await executeStatement<ResultSetHeader>(
        `INSERT INTO users (
           public_id, email, phone, display_name, first_name, last_name, actor_type_code,
           account_status_code, timezone_name, locale_code, avatar_url, login_enabled,
           last_login_at, email_verified_at, phone_verified_at, created_at, updated_at,
           archived_at, row_version
         ) VALUES (
           ?, ?, NULL, ?, ?, ?, 'admin', 'active', 'UTC', 'en-US',
           NULL, 1, NULL, UTC_TIMESTAMP(6), NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6),
           NULL, 1
         )`,
        [createPublicId(), bootstrap.email, bootstrap.name, firstName, lastName],
        connection
      );

      userId = insertResult.insertId;
      userCreated = true;
    } else {
      await executeStatement(
        `UPDATE users
         SET display_name = ?,
             first_name = ?,
             last_name = ?,
             actor_type_code = 'admin',
             account_status_code = 'active',
             login_enabled = 1,
             email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP(6)),
             updated_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [bootstrap.name, firstName, lastName, userId],
        connection
      );
    }

    const credentialRows = await queryRows<CredentialRow>(
      `SELECT user_id, must_rotate_password
       FROM user_credentials
       WHERE user_id = ?
       LIMIT 1`,
      [userId],
      connection
    );
    const credentialsExist = Boolean(credentialRows[0]);
    const passwordAction = !credentialsExist
      ? 'created'
      : bootstrap.resetPassword
        ? 'reset'
        : 'preserved';

    if (!credentialsExist || bootstrap.resetPassword) {
      await executeStatement(
        `INSERT INTO user_credentials (
           user_id, password_hash, password_algo, password_changed_at, must_rotate_password
         ) VALUES (?, ?, 'scrypt', UTC_TIMESTAMP(6), ?)
         ON DUPLICATE KEY UPDATE
           password_hash = VALUES(password_hash),
           password_algo = VALUES(password_algo),
           password_changed_at = VALUES(password_changed_at),
           must_rotate_password = VALUES(must_rotate_password)`,
        [userId, passwordHash, bootstrap.forceRotation ? 1 : 0],
        connection
      );

      await executeStatement(
        `UPDATE user_sessions
         SET revoked_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6)
         WHERE user_id = ?
           AND revoked_at IS NULL`,
        [userId],
        connection
      );
    }

    await executeStatement(
      `INSERT INTO user_roles (
         user_id, role_code, granted_by_user_id, starts_at, ends_at, is_active, created_at, updated_at
       ) VALUES (?, ?, NULL, UTC_TIMESTAMP(6), NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE
         ends_at = NULL,
         is_active = 1,
         updated_at = UTC_TIMESTAMP(6)`,
      [userId, bootstrap.roleCode],
      connection
    );

    await createAuditEvent(
      {
        actionCode: userCreated ? 'admin.bootstrap_created' : 'admin.bootstrap_updated',
        actionLabel: userCreated ? 'Admin bootstrap user created' : 'Admin bootstrap user updated',
        actorRoleCode: bootstrap.roleCode,
        actorUserId: userId,
        changes: [
          { fieldName: 'role_code', newValue: bootstrap.roleCode },
          { fieldName: 'password_action', newValue: passwordAction },
        ],
        entityPk: userId,
        entityTableName: 'users',
        sourceModule: 'admin_bootstrap',
        summaryNewValue: {
          email: bootstrap.email,
          passwordAction,
          roleCode: bootstrap.roleCode,
          userCreated,
        },
      },
      connection
    );

    return {
      email: bootstrap.email,
      forceRotationApplied:
        passwordAction === 'created' || passwordAction === 'reset'
          ? bootstrap.forceRotation
          : Boolean(credentialRows[0]?.must_rotate_password),
      passwordAction,
      resetPassword: bootstrap.resetPassword,
      roleCode: bootstrap.roleCode,
      userCreated,
    };
  });

  logEvent('info', 'admin_bootstrap.completed', {
    email: result.email,
    forceRotationApplied: result.forceRotationApplied,
    passwordAction: result.passwordAction,
    resetPassword: result.resetPassword,
    roleCode: result.roleCode,
    userCreated: result.userCreated,
  });
};

void bootstrapAdmin()
  .catch((error) => {
    logEvent('error', 'admin_bootstrap.failed', {
      errorMessage: error instanceof Error ? error.message : 'Admin bootstrap failed.',
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMysqlPool();
  });
