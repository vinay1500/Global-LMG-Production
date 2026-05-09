import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import {
  createNumericCode,
  createPublicId,
  createRandomToken,
  createSignedCsrfToken,
  hashOpaqueValue,
  hashPassword,
  verifyPassword,
} from '../../lib/authCrypto.js';
import { clearCookie, appendCookie, parseCookies } from '../../lib/httpCookies.js';
import { executeStatement, queryRows, withTransaction, type QueryExecutor } from '../../lib/mysql.js';
import { requireCsrf } from '../../lib/csrf.js';
import {
  AppError,
  badRequest,
  forbidden,
  tooManyRequests,
  unauthorized,
} from '../../lib/httpErrors.js';
import { createAuditEvent } from '../writeSupport.js';
import { sendEmail } from '../providers/email.js';
import { logEvent } from '../../lib/observability.js';
import { getRequestIpAddress, getRequestUserAgent } from '../../lib/requestSecurity.js';
import { recordSecurityEvent } from '../../lib/securityEvents.js';
import { getAdminMfaRequirementMode } from '../settings/platformSettings.js';
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  getPersistentRateLimitStatus,
} from './persistentRateLimiter.js';
import { validateStrongPassword } from './passwordPolicy.js';
import {
  buildAdminTotpQrDataUrl,
  buildAdminTotpUri,
  createAdminMfaRecoveryCodes,
  createAdminTotpSecret,
  decryptAdminMfaSecret,
  encryptAdminMfaSecret,
  hashAdminMfaRecoveryCode,
  recoveryCodeHashMatches,
  verifyAdminTotpCode,
} from './mfa.js';

type ActorRow = RowDataPacket & {
  account_status_code: string;
  display_name: string;
  email: string;
  login_enabled: number;
  must_rotate_password: number | null;
  permission_code: string | null;
  password_hash: string | null;
  public_id: string;
  role_code: string | null;
  user_id: number;
};

type SessionRow = RowDataPacket & {
  account_status_code: string;
  display_name: string;
  email: string;
  expires_at: string;
  last_seen_at: string | Date;
  login_enabled: number;
  must_rotate_password: number | null;
  permission_code: string | null;
  public_id: string;
  role_code: string | null;
  session_id: number;
  user_id: number;
};

type CredentialRow = RowDataPacket & {
  must_rotate_password: number;
  password_hash: string;
};

type PasswordResetTokenRow = RowDataPacket & {
  attempt_count: number;
  code_hash: string;
  consumed_at: string | null;
  display_name: string;
  email: string;
  expires_at: string;
  must_rotate_password: number | null;
  password_hash: string;
  token_id: number;
  user_id: number;
};

type AdminMfaSecretRow = RowDataPacket & {
  enabled_at: string | null;
  id: number;
  last_verified_at: string | null;
  recovery_codes_hash_json: string | null;
  secret_encrypted: string | null;
  user_id: number;
};

type AdminMfaChallengeRow = RowDataPacket & {
  account_status_code: string;
  challenge_id: number;
  challenge_hash: string;
  consumed_at: string | null;
  display_name: string;
  email: string;
  expires_at: string;
  login_enabled: number;
  must_rotate_password: number | null;
  public_id: string;
  remember_me: number;
  session_id?: number;
  user_id: number;
};

export type AdminActor = {
  displayName: string;
  email: string;
  id: string;
  mustRotatePassword: boolean;
  permissionCodes: string[];
  roleCodes: string[];
  sessionId?: number;
  userId: number;
};

const getSignInRateLimitWindowMs = () => env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000;
const getSignInRateLimitLockMs = () => env.AUTH_RATE_LIMIT_LOCK_MINUTES * 60_000;
const ADMIN_PASSWORD_RESET_TTL_MINUTES = 30;
const ADMIN_PASSWORD_RESET_MAX_CODE_ATTEMPTS = 5;
const ADMIN_PASSWORD_RESET_RESPONSE_FLOOR_MS = 700;
const ADMIN_MFA_CHALLENGE_TTL_MINUTES = 10;
const ADMIN_MFA_MAX_CODE_ATTEMPTS = 5;

const COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  secure: env.APP_ENV === 'production',
};

const toAdminSessionUser = (actor: AdminActor) => ({
  displayName: actor.displayName,
  email: actor.email,
  id: actor.id,
  mustRotatePassword: actor.mustRotatePassword,
  permissionCodes: actor.permissionCodes,
  roleCodes: actor.roleCodes,
});

const normalizeIdentifier = (identifier: string) => identifier.trim().toLowerCase();

const toMysqlDateTime = (date: Date) => date.toISOString().slice(0, 23).replace('T', ' ');

const fromMysqlDateTime = (value: string | Date | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const normalized = value.replace(' ', 'T').replace(/(\.\d{3})\d+$/, '$1');
  return new Date(`${normalized}Z`);
};

const maskEmail = (value: string) => {
  const [localPart, domainPart] = value.split('@');
  if (!domainPart) {
    return 'masked-email';
  }

  return `${localPart.slice(0, 2)}***@${domainPart}`;
};

const waitForPasswordResetFloor = async (startedAt: number) => {
  const remainingMs = ADMIN_PASSWORD_RESET_RESPONSE_FLOOR_MS - (Date.now() - startedAt);

  if (remainingMs > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, remainingMs);
    });
  }
};

const getSignInRateLimitKeys = (identifier: string, request: Request) => [
  {
    key: `signin:identifier:${normalizeIdentifier(identifier)}`,
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  },
  {
    key: `signin:ip:${getRequestIpAddress(request)}`,
    maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
  },
];

const getPasswordResetDeliveryMode = () =>
  env.EMAIL_PROVIDER_MODE === 'resend' ? ('email' as const) : ('manual' as const);

const getPasswordResetMessage = () =>
  env.EMAIL_PROVIDER_MODE === 'resend'
    ? 'If an admin account exists for that identifier, password reset instructions will be sent.'
    : 'If an admin account exists for that identifier, a reset request was recorded. Email delivery is in manual/local mode.';

const getPasswordResetRateLimitKeys = (identifier: string, ipAddress: string) => [
  {
    key: `password-reset:identifier:${normalizeIdentifier(identifier)}`,
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  },
  {
    key: `password-reset:ip:${ipAddress || 'unknown'}`,
    maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
  },
];

const consumeAuthRateLimits = async (
  keys: Array<{ key: string; maxAttempts: number }>
) => {
  for (const key of keys) {
    const rateLimit = await consumePersistentRateLimit({
      key: key.key,
      lockMs: getSignInRateLimitLockMs(),
      maxAttempts: key.maxAttempts,
      scope: 'admin_auth',
      windowMs: getSignInRateLimitWindowMs(),
    });

    if (!rateLimit.allowed) {
      await recordSecurityEvent({
        eventTypeCode: 'admin.rate_limit_blocked',
        identifierValue: key.key,
        success: false,
      });
      throw tooManyRequests(
        'admin_auth_rate_limited',
        `Too many attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
        { retryAfterSeconds: rateLimit.retryAfterSeconds }
      );
    }
  }
};

const assertSignInAllowed = async (
  keys: Array<{ key: string; maxAttempts: number }>
) => {
  for (const key of keys) {
    const rateLimit = await getPersistentRateLimitStatus({
      key: key.key,
      maxAttempts: key.maxAttempts,
      scope: 'admin_auth',
      windowMs: getSignInRateLimitWindowMs(),
    });

    if (!rateLimit.allowed) {
      await recordSecurityEvent({
        eventTypeCode: 'admin.rate_limit_blocked',
        identifierValue: key.key,
        success: false,
      });
      throw tooManyRequests(
        'admin_sign_in_rate_limited',
        `Too many failed sign-in attempts. Try again in ${rateLimit.retryAfterSeconds} seconds.`,
        { retryAfterSeconds: rateLimit.retryAfterSeconds }
      );
    }
  }
};

const recordSignInFailure = async (
  keys: Array<{ key: string; maxAttempts: number }>
) => {
  for (const key of keys) {
    await consumePersistentRateLimit({
      key: key.key,
      lockMs: getSignInRateLimitLockMs(),
      maxAttempts: key.maxAttempts,
      scope: 'admin_auth',
      windowMs: getSignInRateLimitWindowMs(),
    });
  }
};

const clearSignInFailures = async (identifier: string) => {
  await clearPersistentRateLimit({
    key: `signin:identifier:${normalizeIdentifier(identifier)}`,
    scope: 'admin_auth',
  });
};

const getActiveSessionLimitSql = () =>
  String(Math.max(1, Math.trunc(env.MAX_ACTIVE_SESSIONS_PER_USER)));

const getMfaRateLimitKeys = (scope: string, request: Request, identifier?: string) => [
  {
    key: `${scope}:ip:${getRequestIpAddress(request) || 'unknown'}`,
    maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
  },
  ...(identifier
    ? [
        {
          key: `${scope}:flow:${identifier}`,
          maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
        },
      ]
    : []),
];

const shouldCountSignInFailure = (error: unknown) =>
  error instanceof AppError &&
  ['invalid_credentials', 'admin_access_required'].includes(error.code);

const collectActor = (rows: Array<ActorRow | SessionRow>) => {
  if (rows.length === 0) {
    return null;
  }

  const first = rows[0]!;
  const roleCodes = Array.from(
    new Set(rows.map((row) => row.role_code).filter((value): value is string => Boolean(value)))
  ).filter((roleCode) => roleCode !== 'client');

  if (!first.login_enabled || roleCodes.length === 0) {
    return null;
  }

  const permissionCodes = Array.from(
    new Set(
      rows.map((row) => row.permission_code).filter((value): value is string => Boolean(value))
    )
  );

  return {
    displayName: first.display_name,
    email: first.email,
    id: first.public_id,
    mustRotatePassword: Boolean(first.must_rotate_password),
    permissionCodes,
    roleCodes,
    sessionId: 'session_id' in first ? first.session_id : undefined,
    userId: first.user_id,
  } satisfies AdminActor;
};

const getSessionToken = (request: Request) =>
  parseCookies(request.headers.cookie)[env.SESSION_COOKIE_NAME] || null;

const setSessionCookies = (
  response: Response,
  payload: { csrfToken: string; rememberMe: boolean; sessionToken: string }
) => {
  appendCookie(response, env.SESSION_COOKIE_NAME, payload.sessionToken, {
    ...COOKIE_OPTIONS,
    httpOnly: true,
    maxAge: payload.rememberMe ? env.REMEMBER_ME_TTL_DAYS * 24 * 60 * 60 : undefined,
  });
  appendCookie(response, env.CSRF_COOKIE_NAME, payload.csrfToken, {
    ...COOKIE_OPTIONS,
    httpOnly: false,
    maxAge: payload.rememberMe ? env.REMEMBER_ME_TTL_DAYS * 24 * 60 * 60 : undefined,
  });
};

export const clearSessionCookies = (response: Response) => {
  clearCookie(response, env.SESSION_COOKIE_NAME, COOKIE_OPTIONS);
  clearCookie(response, env.CSRF_COOKIE_NAME, COOKIE_OPTIONS);
};

export const pruneActiveSessionsForUser = async (
  userId: number,
  executor: QueryExecutor
) => {
  const activeSessionLimit = getActiveSessionLimitSql();

  await executeStatement(
    `UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)),
            updated_at = UTC_TIMESTAMP(6)
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at <= UTC_TIMESTAMP(6)`,
    [userId],
    executor
  );

  await executeStatement(
    `UPDATE user_sessions
        SET revoked_at = UTC_TIMESTAMP(6),
            updated_at = UTC_TIMESTAMP(6)
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND id NOT IN (
          SELECT id FROM (
            SELECT id
              FROM user_sessions
             WHERE user_id = ?
               AND revoked_at IS NULL
               AND expires_at > UTC_TIMESTAMP(6)
             ORDER BY created_at DESC, id DESC
             LIMIT ${activeSessionLimit}
          ) keep_sessions
        )`,
    [userId, userId],
    executor
  );
};

const fetchActorByIdentifier = async (identifier: string) => {
  const rows = await queryRows<ActorRow>(
    `SELECT
       u.id AS user_id,
       u.public_id,
       u.email,
       u.display_name,
       u.login_enabled,
       u.account_status_code,
       uc.password_hash,
       uc.must_rotate_password,
       r.code AS role_code,
       rp.permission_code
     FROM users u
     LEFT JOIN user_credentials uc ON uc.user_id = u.id
     LEFT JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
     LEFT JOIN roles r
       ON r.code = ur.role_code
      AND r.is_active = 1
      AND r.code <> 'client'
     LEFT JOIN role_permissions rp ON rp.role_code = r.code
     WHERE (u.email = ? OR u.phone = ?)
       AND u.archived_at IS NULL
       AND u.actor_type_code <> 'client'`,
    [identifier, identifier]
  );

  return {
    actor: collectActor(rows),
    firstRow: rows[0] || null,
  };
};

const fetchActorByUserId = async (userId: number, executor?: QueryExecutor) => {
  const rows = await queryRows<ActorRow>(
    `SELECT
       u.id AS user_id,
       u.public_id,
       u.email,
       u.display_name,
       u.login_enabled,
       u.account_status_code,
       uc.password_hash,
       uc.must_rotate_password,
       r.code AS role_code,
       rp.permission_code
     FROM users u
     LEFT JOIN user_credentials uc ON uc.user_id = u.id
     LEFT JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
     LEFT JOIN roles r
       ON r.code = ur.role_code
      AND r.is_active = 1
      AND r.code <> 'client'
     LEFT JOIN role_permissions rp ON rp.role_code = r.code
     WHERE u.id = ?
       AND u.archived_at IS NULL
       AND u.actor_type_code <> 'client'`,
    [userId],
    executor
  );

  return collectActor(rows);
};

const fetchAdminMfaSecret = async (userId: number, executor?: QueryExecutor) => {
  const rows = await queryRows<AdminMfaSecretRow>(
    `SELECT
       id,
       user_id,
       secret_encrypted,
       enabled_at,
       recovery_codes_hash_json,
       last_verified_at
     FROM admin_mfa_secrets
     WHERE user_id = ?
     LIMIT 1`,
    [userId],
    executor
  );

  return rows[0] || null;
};

const isAdminMfaEnabled = (row: AdminMfaSecretRow | null) =>
  Boolean(row?.enabled_at && row.secret_encrypted);

const createAdminSessionRecord = async (
  actor: AdminActor,
  rememberMe: boolean,
  request: Request,
  executor: QueryExecutor
) => {
  const sessionToken = createRandomToken();
  const csrfToken = createSignedCsrfToken(env.AUTH_SESSION_SECRET);
  const sessionTokenHash = hashOpaqueValue(sessionToken, env.AUTH_SESSION_SECRET);

  // csrf_secret_hash is a legacy required column; active CSRF validation uses the signed double-submit cookie.
  await executeStatement(
    `INSERT INTO user_sessions (
       public_id, user_id, session_token_hash, csrf_secret_hash, remember_me, ip_address,
       user_agent, device_label, expires_at, last_seen_at, revoked_at, created_at, updated_at
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6) + INTERVAL ? HOUR, UTC_TIMESTAMP(6),
       NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
     )`,
    [
      createPublicId(),
      actor.userId,
      sessionTokenHash,
      sessionTokenHash,
      rememberMe ? 1 : 0,
      getRequestIpAddress(request),
      getRequestUserAgent(request),
      null,
      rememberMe ? env.REMEMBER_ME_TTL_DAYS * 24 : env.SESSION_TTL_HOURS,
    ],
    executor
  );

  await executeStatement(
    `UPDATE users SET last_login_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
    [actor.userId],
    executor
  );

  await pruneActiveSessionsForUser(actor.userId, executor);

  return {
    csrfToken,
    sessionToken,
  };
};

const issueAdminSession = async (
  actor: AdminActor,
  rememberMe: boolean,
  request: Request,
  response: Response
) => {
  const tokens = await withTransaction((connection) =>
    createAdminSessionRecord(actor, rememberMe, request, connection)
  );

  setSessionCookies(response, {
    csrfToken: tokens.csrfToken,
    rememberMe,
    sessionToken: tokens.sessionToken,
  });

  return {
    authenticated: true,
    user: toAdminSessionUser(actor),
  };
};

const createAdminMfaChallenge = async (
  actor: AdminActor,
  rememberMe: boolean,
  request: Request
) => {
  const challengeToken = createRandomToken();
  const challengeHash = hashOpaqueValue(challengeToken, env.AUTH_SESSION_SECRET);

  await executeStatement(
    `INSERT INTO admin_mfa_challenges (
       public_id,
       user_id,
       challenge_hash,
       remember_me,
       expires_at,
       consumed_at,
       attempt_count,
       ip_address,
       user_agent,
       created_at,
       updated_at
     ) VALUES (
       ?, ?, ?, ?, UTC_TIMESTAMP(6) + INTERVAL ? MINUTE, NULL, 0, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
     )`,
    [
      createPublicId(),
      actor.userId,
      challengeHash,
      rememberMe ? 1 : 0,
      ADMIN_MFA_CHALLENGE_TTL_MINUTES,
      getRequestIpAddress(request),
      getRequestUserAgent(request),
    ]
  );

  return challengeToken;
};

const fetchActorBySessionToken = async (rawSessionToken: string) => {
  const hashedToken = hashOpaqueValue(rawSessionToken, env.AUTH_SESSION_SECRET);
  const rows = await queryRows<SessionRow>(
    `SELECT
       us.id AS session_id,
       us.user_id,
       us.expires_at,
       us.last_seen_at,
       u.public_id,
       u.email,
       u.display_name,
       u.login_enabled,
       u.account_status_code,
       uc.must_rotate_password,
       r.code AS role_code,
       rp.permission_code
     FROM user_sessions us
     JOIN users u ON u.id = us.user_id
     LEFT JOIN user_credentials uc ON uc.user_id = u.id
     LEFT JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
     LEFT JOIN roles r
       ON r.code = ur.role_code
      AND r.is_active = 1
      AND r.code <> 'client'
     LEFT JOIN role_permissions rp ON rp.role_code = r.code
     WHERE us.session_token_hash = ?
       AND us.revoked_at IS NULL
       AND us.expires_at > UTC_TIMESTAMP(6)
       AND u.archived_at IS NULL
       AND u.actor_type_code <> 'client'`,
    [hashedToken]
  );

  if (rows.length === 0) {
    return null;
  }

  const actor = collectActor(rows);
  if (!actor) {
    return null;
  }

  return {
    actor,
    lastSeenAt: fromMysqlDateTime(rows[0]!.last_seen_at),
    sessionId: rows[0]!.session_id,
  };
};

const fetchPasswordResetToken = async (token: string) => {
  const rows = await queryRows<PasswordResetTokenRow>(
    `SELECT
       prt.id AS token_id,
       prt.user_id,
       prt.code_hash,
       prt.expires_at,
       prt.consumed_at,
       prt.attempt_count,
       u.email,
       u.display_name,
       uc.password_hash,
       uc.must_rotate_password
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     JOIN user_credentials uc ON uc.user_id = u.id
     WHERE prt.public_id = ?
       AND u.archived_at IS NULL
       AND u.login_enabled = 1
       AND u.actor_type_code <> 'client'
       AND EXISTS (
         SELECT 1
           FROM user_roles ur
           JOIN roles r ON r.code = ur.role_code
          WHERE ur.user_id = u.id
            AND ur.is_active = 1
            AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
            AND (ur.ends_at IS NULL OR ur.ends_at >= UTC_TIMESTAMP(6))
            AND r.is_active = 1
            AND r.code <> 'client'
       )
     LIMIT 1`,
    [token]
  );

  return rows[0] || null;
};

const auditAdminPasswordResetRequested = async (
  input: {
    deliveryStatus: string;
    errorMessage?: string | null;
    maskedRecipient: string;
    providerCode: string;
    providerReference?: string | null;
    userId: number;
  },
  executor?: Parameters<typeof createAuditEvent>[1]
) => {
  await createAuditEvent(
    {
      actionCode: 'admin.password_reset_requested',
      actionLabel: 'Admin password reset requested',
      actorRoleCode: 'system',
      actorUserId: null,
      changes: [
        { fieldName: 'provider_code', newValue: input.providerCode },
        { fieldName: 'delivery_status', newValue: input.deliveryStatus },
        { fieldName: 'provider_reference', newValue: input.providerReference || null },
        { fieldName: 'failure_reason', newValue: input.errorMessage || null },
        { fieldName: 'recipient', newValue: input.maskedRecipient },
      ],
      entityPk: input.userId,
      entityTableName: 'users',
      sourceModule: 'admin_auth',
      summaryNewValue: {
        deliveryStatus: input.deliveryStatus,
        providerCode: input.providerCode,
      },
    },
    executor
  );
};

const deliverPasswordResetEmail = async (input: {
  code: string;
  displayName: string;
  email: string;
  resetToken: string;
  userId: number;
}) => {
  const resetUrl = new URL('/login', env.PUBLIC_ADMIN_WEB_ORIGIN);
  resetUrl.searchParams.set('resetToken', input.resetToken);

  const text = [
    `Hello ${input.displayName},`,
    '',
    'Use this code to reset your Global LMG admin password:',
    input.code,
    '',
    `Reset link: ${resetUrl.toString()}`,
    '',
    `This code expires in ${ADMIN_PASSWORD_RESET_TTL_MINUTES} minutes.`,
    'If you did not request this reset, ignore this email and contact an ops admin.',
  ].join('\n');

  const result = await sendEmail({
    subject: 'Global LMG admin password reset',
    text,
    to: input.email,
  });

  await auditAdminPasswordResetRequested({
    deliveryStatus: result.status,
    errorMessage: result.errorMessage || null,
    maskedRecipient: maskEmail(input.email),
    providerCode: result.providerCode,
    providerReference: result.providerReference || null,
    userId: input.userId,
  });
};

export const getSession = async (request: Request, response: Response) => {
  const rawSessionToken = getSessionToken(request);

  if (!rawSessionToken) {
    clearSessionCookies(response);
    return {
      authenticated: false,
      user: null,
    };
  }

  const resolution = await fetchActorBySessionToken(rawSessionToken);

  if (!resolution) {
    clearSessionCookies(response);
    return {
      authenticated: false,
      user: null,
    };
  }

  if (!resolution.lastSeenAt || Date.now() - resolution.lastSeenAt.getTime() >= 5 * 60_000) {
    await queryRows(`UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [
      resolution.sessionId,
    ]);
  }

  const csrfToken = createSignedCsrfToken(env.AUTH_SESSION_SECRET);

  appendCookie(response, env.CSRF_COOKIE_NAME, csrfToken, {
    ...COOKIE_OPTIONS,
    httpOnly: false,
  });

  return {
    authenticated: true,
    user: toAdminSessionUser(resolution.actor),
  };
};

export const signIn = async (
  identifier: string,
  password: string,
  rememberMe: boolean,
  request: Request,
  response: Response
) => {
  const rateLimitKeys = getSignInRateLimitKeys(identifier, request);
  await assertSignInAllowed(rateLimitKeys);

  try {
    const initialResolution = await fetchActorByIdentifier(identifier);

    if (!initialResolution.firstRow?.password_hash) {
      throw unauthorized('invalid_credentials', 'Invalid email or password.');
    }

    const passwordMatches = await verifyPassword(password, initialResolution.firstRow.password_hash);
    if (!passwordMatches) {
      throw unauthorized('invalid_credentials', 'Invalid email or password.');
    }

    const actor = initialResolution.actor;

    if (!actor) {
      throw forbidden(
        'admin_access_required',
        'This account does not have admin access yet. Ask an existing admin to grant a role.'
      );
    }

    await clearSignInFailures(identifier);

    const mfaSecret = await fetchAdminMfaSecret(actor.userId);
    if (isAdminMfaEnabled(mfaSecret)) {
      const mfaToken = await createAdminMfaChallenge(actor, rememberMe, request);
      await recordSecurityEvent({
        eventTypeCode: 'admin.mfa_required',
        ipAddress: getRequestIpAddress(request),
        success: true,
        userAgent: getRequestUserAgent(request),
        userId: actor.userId,
      });

      return {
        authenticated: false,
        mfaRequired: true,
        mfaToken,
        message: 'Enter the 6-digit code from your authenticator app.',
        user: null,
      };
    }

    const mfaRequirementMode = await getAdminMfaRequirementMode();
    if (mfaRequirementMode === 'enforce') {
      await recordSecurityEvent({
        eventTypeCode: 'admin.mfa_required',
        identifierValue: normalizeIdentifier(identifier),
        ipAddress: getRequestIpAddress(request),
        success: false,
        userAgent: getRequestUserAgent(request),
        userId: actor.userId,
      });
      throw forbidden(
        'admin_mfa_enrollment_required',
        'Multi-factor authentication is required for admin access. Ask an ops administrator to help complete enrollment or temporarily switch MFA rollout to warn mode.'
      );
    }

    return await issueAdminSession(actor, rememberMe, request, response);
  } catch (error) {
    if (shouldCountSignInFailure(error)) {
      await recordSecurityEvent({
        eventTypeCode: 'admin.login_failed',
        identifierValue: normalizeIdentifier(identifier),
        ipAddress: getRequestIpAddress(request),
        success: false,
        userAgent: getRequestUserAgent(request),
      });
      await recordSignInFailure(rateLimitKeys);
    }

    throw error;
  }
};

const recordAdminMfaAudit = async (
  input: {
    actionCode: 'admin.mfa_disabled' | 'admin.mfa_enrolled' | 'admin.mfa_failed' | 'admin.mfa_verified';
    actorRoleCode?: string;
    actorUserId: number | null;
    changes?: Array<{ fieldName: string; newValue: unknown; oldValue?: unknown }>;
    entityUserId: number;
    summary?: Record<string, unknown>;
  },
  executor?: QueryExecutor
) => {
  await createAuditEvent(
    {
      actionCode: input.actionCode,
      actionLabel: input.actionCode
        .replace(/^admin\./, 'Admin ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (value) => value.toUpperCase()),
      actorRoleCode: input.actorRoleCode || 'ops_admin',
      actorUserId: input.actorUserId,
      changes: input.changes || [],
      entityPk: input.entityUserId,
      entityTableName: 'users',
      sourceModule: 'admin_auth',
      summaryNewValue: input.summary || { mfaEvent: input.actionCode },
    },
    executor
  );
};

const parseRecoveryCodeHashes = (value: string | null | undefined) => {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
};

const verifyAdminMfaProof = (
  secretRow: AdminMfaSecretRow,
  code: string
): { nextRecoveryCodeHashes: string[]; usedRecoveryCode: boolean; valid: boolean } => {
  if (!secretRow.secret_encrypted) {
    return {
      nextRecoveryCodeHashes: parseRecoveryCodeHashes(secretRow.recovery_codes_hash_json),
      usedRecoveryCode: false,
      valid: false,
    };
  }

  const secret = decryptAdminMfaSecret(secretRow.secret_encrypted);
  if (verifyAdminTotpCode(secret, code)) {
    return {
      nextRecoveryCodeHashes: parseRecoveryCodeHashes(secretRow.recovery_codes_hash_json),
      usedRecoveryCode: false,
      valid: true,
    };
  }

  const recoveryCodeHashes = parseRecoveryCodeHashes(secretRow.recovery_codes_hash_json);
  const recoveryCodeIndex = recoveryCodeHashes.findIndex((hash) =>
    recoveryCodeHashMatches(code, hash)
  );

  if (recoveryCodeIndex === -1) {
    return {
      nextRecoveryCodeHashes: recoveryCodeHashes,
      usedRecoveryCode: false,
      valid: false,
    };
  }

  return {
    nextRecoveryCodeHashes: recoveryCodeHashes.filter((_, index) => index !== recoveryCodeIndex),
    usedRecoveryCode: true,
    valid: true,
  };
};

export const verifyMfaSignIn = async (
  payload: { code: string; mfaToken: string },
  request: Request,
  response: Response
) => {
  const mfaToken = payload.mfaToken.trim();
  const challengeHash = hashOpaqueValue(mfaToken, env.AUTH_SESSION_SECRET);

  await consumeAuthRateLimits(getMfaRateLimitKeys('mfa-signin', request, challengeHash));

  const result = await withTransaction(async (connection) => {
    const challengeRows = await queryRows<AdminMfaChallengeRow>(
      `SELECT
         id AS challenge_id,
         user_id,
         challenge_hash,
         remember_me,
         expires_at,
         consumed_at,
         attempt_count
       FROM admin_mfa_challenges
       WHERE challenge_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [challengeHash],
      connection
    );
    const challenge = challengeRows[0] || null;

    if (!challenge) {
      return { status: 'invalid' as const, tooMany: false, userId: null };
    }

    const expiresAt = fromMysqlDateTime(challenge.expires_at);
    if (
      challenge.consumed_at ||
      !expiresAt ||
      expiresAt.getTime() <= Date.now() ||
      challenge.attempt_count >= ADMIN_MFA_MAX_CODE_ATTEMPTS
    ) {
      return {
        status: 'invalid' as const,
        tooMany: challenge.attempt_count >= ADMIN_MFA_MAX_CODE_ATTEMPTS,
        userId: challenge.user_id,
      };
    }

    const actor = await fetchActorByUserId(challenge.user_id, connection);
    const mfaSecret = await fetchAdminMfaSecret(challenge.user_id, connection);

    if (!actor || !isAdminMfaEnabled(mfaSecret)) {
      return { status: 'invalid' as const, tooMany: false, userId: challenge.user_id };
    }

    const verification = verifyAdminMfaProof(mfaSecret!, payload.code);
    if (!verification.valid) {
      const nextAttemptCount = challenge.attempt_count + 1;
      await executeStatement(
        `UPDATE admin_mfa_challenges
            SET attempt_count = attempt_count + 1,
                updated_at = UTC_TIMESTAMP(6)
          WHERE id = ?`,
        [challenge.challenge_id],
        connection
      );
      await recordAdminMfaAudit(
        {
          actionCode: 'admin.mfa_failed',
          actorUserId: actor.userId,
          entityUserId: actor.userId,
          summary: { reason: 'invalid_code', surface: 'sign_in' },
        },
        connection
      );
      await recordSecurityEvent(
        {
          eventTypeCode: 'admin.mfa_failed',
          ipAddress: getRequestIpAddress(request),
          success: false,
          userAgent: getRequestUserAgent(request),
          userId: actor.userId,
        },
        connection
      );

      return {
        status: 'invalid' as const,
        tooMany: nextAttemptCount >= ADMIN_MFA_MAX_CODE_ATTEMPTS,
        userId: actor.userId,
      };
    }

    await executeStatement(
      `UPDATE admin_mfa_challenges
          SET consumed_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?`,
      [challenge.challenge_id],
      connection
    );
    await executeStatement(
      `UPDATE admin_mfa_secrets
          SET recovery_codes_hash_json = ?,
              last_verified_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?`,
      [JSON.stringify(verification.nextRecoveryCodeHashes), mfaSecret!.id],
      connection
    );
    await recordAdminMfaAudit(
      {
        actionCode: 'admin.mfa_verified',
        actorUserId: actor.userId,
        entityUserId: actor.userId,
        summary: {
          surface: 'sign_in',
          usedRecoveryCode: verification.usedRecoveryCode,
        },
      },
      connection
    );
    await recordSecurityEvent(
      {
        eventTypeCode: 'admin.mfa_verified',
        ipAddress: getRequestIpAddress(request),
        success: true,
        userAgent: getRequestUserAgent(request),
        userId: actor.userId,
      },
      connection
    );

    const tokens = await createAdminSessionRecord(
      actor,
      Boolean(challenge.remember_me),
      request,
      connection
    );

    return {
      actor,
      rememberMe: Boolean(challenge.remember_me),
      status: 'verified' as const,
      tokens,
    };
  });

  if (result.status !== 'verified') {
    if (result.tooMany) {
      throw tooManyRequests(
        'admin_mfa_rate_limited',
        'Too many invalid verification attempts. Sign in again and try a new code.',
        { retryAfterSeconds: ADMIN_MFA_CHALLENGE_TTL_MINUTES * 60 }
      );
    }

    throw unauthorized('invalid_mfa_code', 'Invalid or expired verification code.');
  }

  setSessionCookies(response, {
    csrfToken: result.tokens.csrfToken,
    rememberMe: result.rememberMe,
    sessionToken: result.tokens.sessionToken,
  });

  return {
    authenticated: true,
    user: toAdminSessionUser(result.actor),
  };
};

export const startMfaEnrollment = async (request: Request) => {
  const actor = await requireAdminSession(request, { requireCsrf: true });
  await consumeAuthRateLimits(getMfaRateLimitKeys('mfa-enroll', request, String(actor.userId)));

  const existing = await fetchAdminMfaSecret(actor.userId);
  if (isAdminMfaEnabled(existing)) {
    throw badRequest('admin_mfa_already_enabled', 'Authenticator app verification is already enabled.');
  }

  const secret = createAdminTotpSecret();
  const provisioningUri = buildAdminTotpUri(actor.email, secret);

  await executeStatement(
    `INSERT INTO admin_mfa_secrets (
       user_id,
       secret_encrypted,
       enabled_at,
       recovery_codes_hash_json,
       last_verified_at,
       created_at,
       updated_at
     ) VALUES (?, ?, NULL, NULL, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE
       secret_encrypted = VALUES(secret_encrypted),
       enabled_at = NULL,
       recovery_codes_hash_json = NULL,
       last_verified_at = NULL,
       updated_at = UTC_TIMESTAMP(6)`,
    [actor.userId, encryptAdminMfaSecret(secret)]
  );

  return {
    provisioningUri,
    qrCodeDataUrl: await buildAdminTotpQrDataUrl(provisioningUri),
    status: 'mfa_enrollment_started' as const,
  };
};

export const verifyMfaEnrollment = async (request: Request, code: string) => {
  const actor = await requireAdminSession(request, { requireCsrf: true });
  await consumeAuthRateLimits(getMfaRateLimitKeys('mfa-enroll-verify', request, String(actor.userId)));

  const mfaSecret = await fetchAdminMfaSecret(actor.userId);
  if (!mfaSecret?.secret_encrypted || mfaSecret.enabled_at) {
    throw badRequest('admin_mfa_enrollment_not_started', 'Start MFA enrollment before verifying a code.');
  }

  const secret = decryptAdminMfaSecret(mfaSecret.secret_encrypted);
  if (!verifyAdminTotpCode(secret, code)) {
    await recordAdminMfaAudit({
      actionCode: 'admin.mfa_failed',
      actorRoleCode: actor.roleCodes[0],
      actorUserId: actor.userId,
      entityUserId: actor.userId,
      summary: { reason: 'invalid_code', surface: 'enrollment' },
    });
    await recordSecurityEvent({
      eventTypeCode: 'admin.mfa_failed',
      ipAddress: getRequestIpAddress(request),
      success: false,
      userAgent: getRequestUserAgent(request),
      userId: actor.userId,
    });
    throw unauthorized('invalid_mfa_code', 'Invalid verification code.');
  }

  const recoveryCodes = createAdminMfaRecoveryCodes();
  const recoveryCodeHashes = recoveryCodes.map(hashAdminMfaRecoveryCode);

  await withTransaction(async (connection) => {
    await executeStatement(
      `UPDATE admin_mfa_secrets
          SET enabled_at = UTC_TIMESTAMP(6),
              recovery_codes_hash_json = ?,
              last_verified_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?`,
      [JSON.stringify(recoveryCodeHashes), mfaSecret.id],
      connection
    );
    await recordAdminMfaAudit(
      {
        actionCode: 'admin.mfa_enrolled',
        actorRoleCode: actor.roleCodes[0],
        actorUserId: actor.userId,
        changes: [{ fieldName: 'mfa_enabled', newValue: true, oldValue: false }],
        entityUserId: actor.userId,
        summary: { mfaEnabled: true },
      },
      connection
    );
    await recordAdminMfaAudit(
      {
        actionCode: 'admin.mfa_verified',
        actorRoleCode: actor.roleCodes[0],
        actorUserId: actor.userId,
        entityUserId: actor.userId,
        summary: { surface: 'enrollment' },
      },
      connection
    );
    await recordSecurityEvent(
      {
        eventTypeCode: 'admin.mfa_enrolled',
        ipAddress: getRequestIpAddress(request),
        success: true,
        userAgent: getRequestUserAgent(request),
        userId: actor.userId,
      },
      connection
    );
  });

  return {
    recoveryCodes,
    status: 'mfa_enabled' as const,
  };
};

export const disableMfa = async (
  request: Request,
  payload: { code: string; currentPassword: string }
) => {
  const actor = await requireAdminSession(request, { requireCsrf: true });
  await consumeAuthRateLimits(getMfaRateLimitKeys('mfa-disable', request, String(actor.userId)));

  if ((await getAdminMfaRequirementMode()) === 'enforce') {
    throw forbidden(
      'admin_mfa_required',
      'MFA is currently enforced for admin access. Switch the rollout mode before disabling MFA.'
    );
  }

  const credentialRows = await queryRows<CredentialRow>(
    `SELECT password_hash, must_rotate_password
     FROM user_credentials
     WHERE user_id = ?
     LIMIT 1`,
    [actor.userId]
  );
  const credential = credentialRows[0] || null;
  const passwordMatches =
    credential && (await verifyPassword(payload.currentPassword, credential.password_hash));

  if (!passwordMatches) {
    throw unauthorized('invalid_credentials', 'Invalid password or verification code.');
  }

  const mfaSecret = await fetchAdminMfaSecret(actor.userId);
  if (!isAdminMfaEnabled(mfaSecret)) {
    throw badRequest('admin_mfa_not_enabled', 'Authenticator app verification is not enabled.');
  }

  const secret = decryptAdminMfaSecret(mfaSecret!.secret_encrypted!);
  if (!verifyAdminTotpCode(secret, payload.code)) {
    await recordAdminMfaAudit({
      actionCode: 'admin.mfa_failed',
      actorRoleCode: actor.roleCodes[0],
      actorUserId: actor.userId,
      entityUserId: actor.userId,
      summary: { reason: 'invalid_code', surface: 'disable' },
    });
    await recordSecurityEvent({
      eventTypeCode: 'admin.mfa_failed',
      ipAddress: getRequestIpAddress(request),
      success: false,
      userAgent: getRequestUserAgent(request),
      userId: actor.userId,
    });
    throw unauthorized('invalid_credentials', 'Invalid password or verification code.');
  }

  await withTransaction(async (connection) => {
    await executeStatement(
      `DELETE FROM admin_mfa_secrets WHERE user_id = ?`,
      [actor.userId],
      connection
    );
    await executeStatement(
      `UPDATE admin_mfa_challenges
          SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(6)),
              updated_at = UTC_TIMESTAMP(6)
        WHERE user_id = ?
          AND consumed_at IS NULL`,
      [actor.userId],
      connection
    );
    await recordAdminMfaAudit(
      {
        actionCode: 'admin.mfa_disabled',
        actorRoleCode: actor.roleCodes[0],
        actorUserId: actor.userId,
        changes: [{ fieldName: 'mfa_enabled', newValue: false, oldValue: true }],
        entityUserId: actor.userId,
        summary: { mfaEnabled: false },
      },
      connection
    );
    await recordSecurityEvent(
      {
        eventTypeCode: 'admin.mfa_disabled',
        ipAddress: getRequestIpAddress(request),
        success: true,
        userAgent: getRequestUserAgent(request),
        userId: actor.userId,
      },
      connection
    );
  });

  return {
    status: 'mfa_disabled' as const,
  };
};

export const signOut = async (request: Request, response: Response) => {
  await consumeAuthRateLimits([
    {
      key: `signout:ip:${getRequestIpAddress(request)}`,
      maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
    },
  ]);

  const rawSessionToken = getSessionToken(request);

  if (!rawSessionToken) {
    clearSessionCookies(response);
    return { status: 'signed_out' as const };
  }

  const resolution = await fetchActorBySessionToken(rawSessionToken);

  if (!resolution) {
    clearSessionCookies(response);
    return { status: 'signed_out' as const };
  }

  // Logout is session termination; OWASP treats it as a user safety control, so stale CSRF state must not block the bound session holder.
  await queryRows(`UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [
    resolution.sessionId,
  ]);

  clearSessionCookies(response);
  return { status: 'signed_out' as const };
};

export const requestPasswordReset = async (
  identifier: string,
  context: { ipAddress: string }
) => {
  const startedAt = Date.now();
  await consumeAuthRateLimits(getPasswordResetRateLimitKeys(identifier, context.ipAddress));

  const resolution = await fetchActorByIdentifier(identifier);
  const target =
    resolution.actor && resolution.firstRow?.password_hash
      ? {
          displayName: resolution.actor.displayName,
          email: resolution.actor.email,
          userId: resolution.actor.userId,
        }
      : null;

  await recordSecurityEvent({
    eventTypeCode: 'admin.password_reset_requested',
    identifierValue: normalizeIdentifier(identifier),
    ipAddress: context.ipAddress,
    success: true,
    userId: target?.userId ?? null,
  });

  if (target) {
    const resetToken = createPublicId();
    const code = createNumericCode();
    const codeHash = hashOpaqueValue(code, env.AUTH_SESSION_SECRET);
    const expiresAt = new Date(Date.now() + ADMIN_PASSWORD_RESET_TTL_MINUTES * 60_000);

    await withTransaction(async (connection) => {
      await executeStatement(
        `UPDATE password_reset_tokens
            SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(6)),
                updated_at = UTC_TIMESTAMP(6)
          WHERE user_id = ?
            AND consumed_at IS NULL`,
        [target.userId],
        connection
      );

      await executeStatement<ResultSetHeader>(
        `INSERT INTO password_reset_tokens (
           public_id, user_id, code_hash, expires_at, sent_at, consumed_at, attempt_count,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), NULL, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [resetToken, target.userId, codeHash, toMysqlDateTime(expiresAt)],
        connection
      );
    });

    if (env.EMAIL_PROVIDER_MODE === 'resend') {
      void deliverPasswordResetEmail({
        code,
        displayName: target.displayName,
        email: target.email,
        resetToken,
        userId: target.userId,
      }).catch((error) => {
        logEvent('error', 'admin.password_reset_email_unhandled_error', {
          errorMessage: error instanceof Error ? error.message : 'Unknown email failure.',
          userId: target.userId,
        });
      });
    } else {
      await auditAdminPasswordResetRequested({
        deliveryStatus: env.EMAIL_PROVIDER_MODE === 'preview' ? 'preview' : 'disabled',
        maskedRecipient: maskEmail(target.email),
        providerCode: env.EMAIL_PROVIDER_MODE,
        userId: target.userId,
      });
    }
  }

  await waitForPasswordResetFloor(startedAt);

  return {
    deliveryMode: getPasswordResetDeliveryMode(),
    message: getPasswordResetMessage(),
    status: 'password_reset_requested' as const,
  };
};

export const resetPassword = async (payload: {
  code: string;
  newPassword: string;
  token: string;
}, context: { ipAddress?: string } = {}) => {
  await consumeAuthRateLimits([
    {
      key: `password-reset-confirm:token:${payload.token.trim()}`,
      maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    },
    {
      key: `password-reset-confirm:ip:${context.ipAddress || 'unknown'}`,
      maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
    },
  ]);

  const resetToken = await fetchPasswordResetToken(payload.token.trim());

  if (!resetToken) {
    throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
  }

  const expiresAt = fromMysqlDateTime(resetToken.expires_at);
  if (
    resetToken.consumed_at ||
    !expiresAt ||
    expiresAt.getTime() <= Date.now()
  ) {
    throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
  }

  if (resetToken.attempt_count >= ADMIN_PASSWORD_RESET_MAX_CODE_ATTEMPTS) {
    throw tooManyRequests(
      'admin_password_reset_rate_limited',
      'Too many invalid reset attempts. Request a new password reset.',
      { retryAfterSeconds: ADMIN_PASSWORD_RESET_TTL_MINUTES * 60 }
    );
  }

  const expectedCodeHash = hashOpaqueValue(payload.code.trim(), env.AUTH_SESSION_SECRET);
  if (expectedCodeHash !== resetToken.code_hash) {
    await executeStatement(
      `UPDATE password_reset_tokens
          SET attempt_count = attempt_count + 1,
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?`,
      [resetToken.token_id]
    );
    throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
  }

  validateStrongPassword(payload.newPassword, {
    displayName: resetToken.display_name,
    email: resetToken.email,
  });

  const reusesCurrentPassword = await verifyPassword(
    payload.newPassword,
    resetToken.password_hash
  );

  if (reusesCurrentPassword) {
    throw badRequest(
      'password_reuse_not_allowed',
      'The new password must be different from the current password.'
    );
  }

  const nextPasswordHash = await hashPassword(payload.newPassword);

  await withTransaction(async (connection) => {
    await executeStatement<ResultSetHeader>(
      `UPDATE user_credentials
          SET password_hash = ?,
              password_algo = 'scrypt',
              password_changed_at = UTC_TIMESTAMP(6),
              must_rotate_password = 0
        WHERE user_id = ?`,
      [nextPasswordHash, resetToken.user_id],
      connection
    );

    await executeStatement(
      `UPDATE password_reset_tokens
          SET consumed_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?`,
      [resetToken.token_id],
      connection
    );

    await executeStatement(
      `UPDATE user_sessions
          SET revoked_at = UTC_TIMESTAMP(6),
              updated_at = UTC_TIMESTAMP(6)
        WHERE user_id = ?
          AND revoked_at IS NULL`,
      [resetToken.user_id],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'admin.password_reset_completed',
        actionLabel: 'Admin password reset completed',
        actorRoleCode: 'system',
        actorUserId: null,
        changes: [
          { fieldName: 'must_rotate_password', newValue: false, oldValue: Boolean(resetToken.must_rotate_password) },
          { fieldName: 'sessions_revoked', newValue: true },
        ],
        entityPk: resetToken.user_id,
        entityTableName: 'users',
        sourceModule: 'admin_auth',
        summaryNewValue: { passwordResetCompleted: true },
      },
      connection
    );
    await recordSecurityEvent(
      {
        eventTypeCode: 'admin.password_reset_completed',
        success: true,
        userId: resetToken.user_id,
      },
      connection
    );
  });

  return {
    message: 'Password reset complete. You can sign in with the new password.',
    status: 'password_reset_completed' as const,
  };
};

export const changePassword = async (
  request: Request,
  currentPassword: string,
  newPassword: string
) => {
  const actor = await requireAdminSession(request, {
    allowPasswordRotationRequired: true,
    requireCsrf: true,
  });

  if (newPassword === currentPassword) {
    throw badRequest(
      'password_reuse_not_allowed',
      'The new password must be different from the current password.'
    );
  }

  validateStrongPassword(newPassword, actor);

  const credentialRows = await queryRows<CredentialRow>(
    `SELECT password_hash, must_rotate_password
     FROM user_credentials
     WHERE user_id = ?
     LIMIT 1`,
    [actor.userId]
  );
  const credential = credentialRows[0] || null;

  if (!credential) {
    throw unauthorized('invalid_credentials', 'Invalid current password.');
  }

  const currentPasswordMatches = await verifyPassword(currentPassword, credential.password_hash);
  if (!currentPasswordMatches) {
    throw unauthorized('invalid_credentials', 'Invalid current password.');
  }

  const nextPasswordHash = await hashPassword(newPassword);

  await withTransaction(async (connection) => {
    await executeStatement<ResultSetHeader>(
      `UPDATE user_credentials
       SET password_hash = ?,
           password_algo = 'scrypt',
           password_changed_at = UTC_TIMESTAMP(6),
           must_rotate_password = 0
       WHERE user_id = ?`,
      [nextPasswordHash, actor.userId],
      connection
    );

    await executeStatement(
      `UPDATE user_sessions
       SET revoked_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6)
       WHERE user_id = ?
         AND id <> ?
         AND revoked_at IS NULL`,
      [actor.userId, actor.sessionId || 0],
      connection
    );

    await createAuditEvent(
      {
        actionCode: 'admin.password_changed',
        actionLabel: 'Admin password changed',
        actorRoleCode: actor.roleCodes[0] || 'ops_admin',
        actorUserId: actor.userId,
        changes: [
          {
            fieldName: 'must_rotate_password',
            newValue: false,
            oldValue: Boolean(credential.must_rotate_password),
          },
        ],
        entityPk: actor.userId,
        entityTableName: 'users',
        sourceModule: 'admin_auth',
        summaryNewValue: { mustRotatePassword: false },
        summaryOldValue: { mustRotatePassword: Boolean(credential.must_rotate_password) },
      },
      connection
    );
    await recordSecurityEvent(
      {
        eventTypeCode: 'admin.password_changed',
        success: true,
        userId: actor.userId,
      },
      connection
    );
  });

  return {
    status: 'password_changed' as const,
    user: toAdminSessionUser({
      ...actor,
      mustRotatePassword: false,
    }),
  };
};

export const requireAdminSession = async (
  request: Request,
  options?: { allowPasswordRotationRequired?: boolean; requireCsrf?: boolean }
) => {
  const rawSessionToken = getSessionToken(request);

  if (!rawSessionToken) {
    throw unauthorized('auth_required', 'Authentication is required.');
  }

  const resolution = await fetchActorBySessionToken(rawSessionToken);

  if (!resolution) {
    throw unauthorized('auth_required', 'Authentication is required.');
  }

  if (options?.requireCsrf) {
    requireCsrf(request);
  }

  if (resolution.actor.mustRotatePassword && !options?.allowPasswordRotationRequired) {
    throw forbidden(
      'password_rotation_required',
      'Admin password rotation is required before accessing this resource.'
    );
  }

  return resolution.actor;
};
