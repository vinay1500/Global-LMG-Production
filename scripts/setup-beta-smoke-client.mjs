#!/usr/bin/env node
import { createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import mysql from '../backend/node_modules/mysql2/promise.js';

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const readEnvFile = (filePath) => {
  if (!existsSync(filePath)) {
    return {};
  }

  const entries = {};
  const content = readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
};

const loadEnv = () => {
  const repoRoot = process.cwd();
  const smokeEnvFiles = (process.env.BETA_SMOKE_ENV_FILES || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    ...readEnvFile(path.resolve(repoRoot, 'backend/.env')),
    ...smokeEnvFiles.reduce(
      (merged, filePath) => ({
        ...merged,
        ...readEnvFile(path.resolve(repoRoot, filePath)),
      }),
      {}
    ),
    ...process.env,
  };
};

const toBase64Url = (buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const hashPassword = async (password) => {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${toBase64Url(salt)}$${toBase64Url(derivedKey)}`;
};

const encodeBase32 = (value, length) => {
  let remaining = value;
  let output = '';

  for (let index = 0; index < length; index += 1) {
    const current = Number(remaining & 31n);
    output = `${BASE32[current]}${output}`;
    remaining >>= 5n;
  }

  return output;
};

const createPublicId = () => {
  const timestamp = BigInt(Date.now());
  const randomness = BigInt(`0x${randomBytes(10).toString('hex')}`);
  return `${encodeBase32(timestamp, 10)}${encodeBase32(randomness, 16)}`;
};

const pad = (value, size = 2) => String(value).padStart(size, '0');

const toMysqlDateTime = (date = new Date()) =>
  [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(
      date.getUTCMilliseconds(),
      3
    )}000`,
  ].join(' ');

const normalizeEmail = (value) => value.trim().toLowerCase();

const normalizePhone = (value) => value.trim().replace(/[^\d+]/g, '');

const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  if (!local || !domain) {
    return 'configured-email';
  }
  return `${local.slice(0, 2)}***@${domain}`;
};

const deterministicPhoneForEmail = (email) => {
  const digits = createHash('sha256')
    .update(email)
    .digest('hex')
    .replace(/\D/g, '')
    .padEnd(10, '5')
    .slice(0, 7);
  return `+1555${digits}`;
};

const resolveSslCa = (sslPath) => {
  if (!sslPath) {
    return undefined;
  }

  const candidates = [
    path.resolve(process.cwd(), sslPath),
    path.resolve(process.cwd(), 'backend', sslPath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }

  return undefined;
};

const assertSafeExecution = (env, email) => {
  const appEnv = String(env.APP_ENV || env.NODE_ENV || 'development').trim().toLowerCase();

  if (appEnv === 'production' && env.BETA_SMOKE_SETUP_ALLOW_DISPOSABLE_DB !== 'true') {
    throw new Error(
      'Refusing to create a beta smoke client while APP_ENV=production. This script is for local/disposable DBs only. Set BETA_SMOKE_SETUP_ALLOW_DISPOSABLE_DB=true only after confirming the target DB is disposable.'
    );
  }

  if (!/(\.local$|\+smoke@|smoke[._-]?)/i.test(email)) {
    throw new Error(
      'Refusing to create a smoke client for a non-disposable-looking email. Use a .local address, a +smoke alias, or an email containing smoke.'
    );
  }
};

const getConnection = async (env) => {
  const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
  const missing = required.filter((key) => !env[key]);

  if (missing.length) {
    throw new Error(`Missing required MySQL env vars: ${missing.join(', ')}`);
  }

  return mysql.createConnection({
    connectTimeout: Number(env.MYSQL_CONNECT_TIMEOUT_MS || env.MYSQL_CONNECTION_TIMEOUT_MS || 15000),
    database: env.MYSQL_DATABASE,
    dateStrings: true,
    host: env.MYSQL_HOST,
    password: env.MYSQL_PASSWORD,
    port: Number(env.MYSQL_PORT || 3306),
    ssl:
      env.MYSQL_SSL_MODE === 'REQUIRED'
        ? {
            ca: resolveSslCa(env.MYSQL_SSL_CA || env.MYSQL_SSL_CA_PATH),
            rejectUnauthorized: true,
          }
        : undefined,
    timezone: 'Z',
    user: env.MYSQL_USER,
  });
};

const selectOne = async (connection, sql, params = []) => {
  const [rows] = await connection.query(sql, params);
  return rows[0];
};

const ensureClientRole = async (connection, now) => {
  await connection.execute(
    `INSERT INTO roles (code, name, description, is_system, is_active, created_at, updated_at)
     VALUES ('client', 'Client', 'Portal client user', 1, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       description = VALUES(description),
       is_active = 1,
       updated_at = VALUES(updated_at)`,
    [now, now]
  );
};

const ensureUser = async (connection, input, now) => {
  const existing = await selectOne(
    connection,
    `SELECT id, actor_type_code
     FROM users
     WHERE LOWER(email) = LOWER(?)
     LIMIT 1`,
    [input.email]
  );

  const passwordHash = await hashPassword(input.password);
  const [firstName, ...lastNameParts] = input.name.trim().split(/\s+/);
  const lastName = lastNameParts.join(' ') || null;

  if (existing) {
    if (existing.actor_type_code !== 'client') {
      throw new Error('Configured smoke email already belongs to a non-client user.');
    }

    await connection.execute(
      `UPDATE users
       SET phone = ?,
           display_name = ?,
           first_name = ?,
           last_name = ?,
           actor_type_code = 'client',
           account_status_code = 'active',
           timezone_name = ?,
           locale_code = ?,
           login_enabled = 1,
           email_verified_at = COALESCE(email_verified_at, ?),
           phone_verified_at = COALESCE(phone_verified_at, ?),
           updated_at = ?,
           archived_at = NULL
       WHERE id = ?`,
      [
        input.phone,
        input.name,
        firstName || input.name,
        lastName,
        input.timezone,
        input.locale,
        now,
        now,
        now,
        existing.id,
      ]
    );

    await connection.execute(
      `INSERT INTO user_credentials (
         user_id, password_hash, password_algo, password_changed_at, must_rotate_password
       ) VALUES (?, ?, 'scrypt', ?, 0)
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         password_algo = VALUES(password_algo),
         password_changed_at = VALUES(password_changed_at),
         must_rotate_password = 0`,
      [existing.id, passwordHash, now]
    );

    return { created: false, userId: existing.id };
  }

  const [result] = await connection.execute(
    `INSERT INTO users (
       public_id, email, phone, display_name, first_name, last_name, actor_type_code,
       account_status_code, timezone_name, locale_code, avatar_url, login_enabled,
       last_login_at, email_verified_at, phone_verified_at, created_at, updated_at, archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'client', 'active', ?, ?, '', 1, NULL, ?, ?, ?, ?, NULL)`,
    [
      createPublicId(),
      input.email,
      input.phone,
      input.name,
      firstName || input.name,
      lastName,
      input.timezone,
      input.locale,
      now,
      now,
      now,
      now,
    ]
  );

  await connection.execute(
    `INSERT INTO user_credentials (
       user_id, password_hash, password_algo, password_changed_at, must_rotate_password
     ) VALUES (?, ?, 'scrypt', ?, 0)`,
    [result.insertId, passwordHash, now]
  );

  return { created: true, userId: result.insertId };
};

const ensureClientAccount = async (connection, input, userId, now) => {
  const existingContact = await selectOne(
    connection,
    `SELECT ca.id
     FROM client_accounts ca
     INNER JOIN client_account_contacts cac ON cac.client_account_id = ca.id
     WHERE cac.user_id = ?
       AND cac.archived_at IS NULL
     ORDER BY ca.id ASC
     LIMIT 1`,
    [userId]
  );

  const existingByEmail = existingContact
    ? null
    : await selectOne(
        connection,
        `SELECT id
         FROM client_accounts
         WHERE LOWER(primary_email) = LOWER(?)
         ORDER BY id ASC
         LIMIT 1`,
        [input.email]
      );

  const clientAccountId = existingContact?.id || existingByEmail?.id;

  if (clientAccountId) {
    await connection.execute(
      `UPDATE client_accounts
       SET client_type_code = 'individual',
           legal_name = ?,
           display_name = ?,
           billing_name = ?,
           primary_email = ?,
           primary_phone = ?,
           onboarding_status_code = 'active',
           account_status_code = 'active',
           owner_user_id = COALESCE(owner_user_id, ?),
           updated_at = ?,
           archived_at = NULL
       WHERE id = ?`,
      [input.name, input.name, input.name, input.email, input.phone, userId, now, clientAccountId]
    );

    return { clientAccountId, created: false };
  }

  const clientCode = `SMOKE-${createHash('sha1').update(input.email).digest('hex').slice(0, 10).toUpperCase()}`;
  const [result] = await connection.execute(
    `INSERT INTO client_accounts (
       public_id, client_code, client_type_code, legal_name, display_name, billing_name,
       primary_email, primary_phone, gstin, tax_identifier, onboarding_status_code,
       account_status_code, owner_user_id, created_at, updated_at, archived_at
     ) VALUES (?, ?, 'individual', ?, ?, ?, ?, ?, NULL, NULL, 'active', 'active', ?, ?, ?, NULL)`,
    [
      createPublicId(),
      clientCode,
      input.name,
      input.name,
      input.name,
      input.email,
      input.phone,
      userId,
      now,
      now,
    ]
  );

  return { clientAccountId: result.insertId, created: true };
};

const ensureContact = async (connection, clientAccountId, userId, phone, now) => {
  await connection.execute(
    `INSERT INTO client_account_contacts (
       client_account_id, user_id, contact_role_code, is_primary, is_billing,
       mobile_number, portal_access_enabled, created_at, updated_at, archived_at
     ) VALUES (?, ?, 'primary', 1, 1, ?, 1, ?, ?, NULL)
     ON DUPLICATE KEY UPDATE
       contact_role_code = 'primary',
       is_primary = 1,
       is_billing = 1,
       mobile_number = VALUES(mobile_number),
       portal_access_enabled = 1,
       updated_at = VALUES(updated_at),
       archived_at = NULL`,
    [clientAccountId, userId, phone, now, now]
  );
};

const ensureAddress = async (connection, clientAccountId, input, now) => {
  let activeAddressId;
  const existing = await selectOne(
    connection,
    `SELECT id
     FROM client_addresses
     WHERE client_account_id = ?
       AND is_primary = 1
     ORDER BY archived_at IS NULL DESC, id ASC
     LIMIT 1`,
    [clientAccountId]
  );

  if (existing) {
    activeAddressId = existing.id;
    await connection.execute(
      `UPDATE client_addresses
       SET address_type_code = 'primary',
           line1 = ?,
           line2 = ?,
           city = ?,
           state = ?,
           postal_code = ?,
           country_code = ?,
           source_code = 'manual',
           google_place_id = NULL,
           validation_status_code = 'manual',
           is_primary = 1,
           updated_at = ?,
           archived_at = NULL
       WHERE id = ?`,
      [
        input.addressLine1,
        input.addressLine2 || null,
        input.city,
        input.state,
        input.postalCode,
        input.country,
        now,
        existing.id,
      ]
    );
  } else {
    const [result] = await connection.execute(
      `INSERT INTO client_addresses (
         client_account_id, address_type_code, line1, line2, city, state, postal_code,
         country_code, source_code, google_place_id, validation_status_code, is_primary,
         created_at, updated_at, archived_at
       ) VALUES (?, 'primary', ?, ?, ?, ?, ?, ?, 'manual', NULL, 'manual', 1, ?, ?, NULL)`,
      [
        clientAccountId,
        input.addressLine1,
        input.addressLine2 || null,
        input.city,
        input.state,
        input.postalCode,
        input.country,
        now,
        now,
      ]
    );
    activeAddressId = result.insertId;
  }

  await connection.execute(
    `UPDATE client_addresses
     SET is_primary = 0,
         archived_at = COALESCE(archived_at, ?),
         updated_at = ?
     WHERE client_account_id = ?
       AND id <> ?
       AND is_primary = 1`,
    [now, now, clientAccountId, activeAddressId]
  );
};

const ensurePreferencesAndRole = async (connection, userId, now) => {
  await connection.execute(
    `INSERT INTO user_notification_preferences (
       user_id, in_app_alerts, email_updates, sms_alerts, invoice_reminders,
       case_activity_alerts, product_announcements, updated_at
     ) VALUES (?, 1, 1, 1, 1, 1, 0, ?)
     ON DUPLICATE KEY UPDATE
       in_app_alerts = 1,
       email_updates = 1,
       sms_alerts = 1,
       invoice_reminders = 1,
       case_activity_alerts = 1,
       product_announcements = 0,
       updated_at = VALUES(updated_at)`,
    [userId, now]
  );

  await connection.execute(
    `INSERT INTO user_roles (
       user_id, role_code, granted_by_user_id, starts_at, ends_at, is_active, created_at, updated_at
     ) VALUES (?, 'client', NULL, ?, NULL, 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       starts_at = VALUES(starts_at),
       ends_at = NULL,
       is_active = 1,
       updated_at = VALUES(updated_at)`,
    [userId, now, now, now]
  );
};

const main = async () => {
  const env = loadEnv();
  const email = normalizeEmail(env.BETA_SMOKE_CLIENT_EMAIL || '');
  const password = env.BETA_SMOKE_CLIENT_PASSWORD || '';

  if (!email || !password) {
    throw new Error('Set BETA_SMOKE_CLIENT_EMAIL and BETA_SMOKE_CLIENT_PASSWORD before running this script.');
  }

  if (password.length < 8) {
    throw new Error('BETA_SMOKE_CLIENT_PASSWORD must be at least 8 characters.');
  }

  assertSafeExecution(env, email);

  const input = {
    addressLine1: env.BETA_SMOKE_CLIENT_ADDRESS_LINE1 || '123 Smoke Test Street',
    addressLine2: env.BETA_SMOKE_CLIENT_ADDRESS_LINE2 || '',
    city: env.BETA_SMOKE_CLIENT_CITY || 'San Francisco',
    country: String(env.BETA_SMOKE_CLIENT_COUNTRY || 'US').trim().toUpperCase(),
    email,
    locale: env.BETA_SMOKE_CLIENT_LOCALE || 'en-US',
    name: env.BETA_SMOKE_CLIENT_NAME || 'Beta Smoke Client',
    password,
    phone: normalizePhone(env.BETA_SMOKE_CLIENT_PHONE || deterministicPhoneForEmail(email)),
    postalCode: env.BETA_SMOKE_CLIENT_POSTAL_CODE || '94105',
    state: env.BETA_SMOKE_CLIENT_STATE || 'California',
    timezone: env.BETA_SMOKE_CLIENT_TIMEZONE || 'America/Los_Angeles',
  };

  const now = toMysqlDateTime();
  const connection = await getConnection(env);

  try {
    await connection.beginTransaction();
    await ensureClientRole(connection, now);
    const user = await ensureUser(connection, input, now);
    const account = await ensureClientAccount(connection, input, user.userId, now);
    await ensureContact(connection, account.clientAccountId, user.userId, input.phone, now);
    await ensureAddress(connection, account.clientAccountId, input, now);
    await ensurePreferencesAndRole(connection, user.userId, now);
    await connection.commit();

    console.log(
      JSON.stringify(
        {
          clientAccount: account.created ? 'created' : 'updated',
          email: maskEmail(input.email),
          portalAccess: 'enabled',
          status: 'ready',
          user: user.created ? 'created' : 'updated',
        },
        null,
        2
      )
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unable to set up beta smoke client.');
  process.exitCode = 1;
});
