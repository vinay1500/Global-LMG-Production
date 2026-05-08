import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import {
  createNumericCode,
  createPublicId,
  createRandomToken,
  hashOpaqueValue,
  hashPassword,
  verifyPassword,
} from '../../lib/authCrypto.js';
import { clearCookie, appendCookie, parseCookies } from '../../lib/httpCookies.js';
import { executeStatement, queryRows, withTransaction } from '../../lib/mysql.js';
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
import { recordSecurityEvent, recordSecurityEventSafely } from '../../lib/securityEvents.js';
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  getPersistentRateLimitStatus,
} from './persistentRateLimiter.js';
import { validateStrongPassword } from './passwordPolicy.js';

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
  csrf_secret_hash: string;
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

const getRequestIpAddress = (request: Request) =>
  request.ip || request.socket.remoteAddress || 'unknown';

const getRequestUserAgent = (request: Request) => request.header('user-agent')?.trim() || null;

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

const getCsrfToken = (request: Request) =>
  request.header('x-csrf-token') || parseCookies(request.headers.cookie)[env.CSRF_COOKIE_NAME] || null;

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
     WHERE (LOWER(u.email) = LOWER(?) OR u.phone = ?)
       AND u.archived_at IS NULL
       AND u.actor_type_code <> 'client'`,
    [identifier, identifier]
  );

  return {
    actor: collectActor(rows),
    firstRow: rows[0] || null,
  };
};

const fetchActorBySessionToken = async (rawSessionToken: string) => {
  const hashedToken = hashOpaqueValue(rawSessionToken, env.AUTH_SESSION_SECRET);
  const rows = await queryRows<SessionRow>(
    `SELECT
       us.id AS session_id,
       us.user_id,
       us.csrf_secret_hash,
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
    csrfHash: rows[0]!.csrf_secret_hash,
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
      csrfToken: null,
      user: null,
    };
  }

  const resolution = await fetchActorBySessionToken(rawSessionToken);

  if (!resolution) {
    clearSessionCookies(response);
    return {
      authenticated: false,
      csrfToken: null,
      user: null,
    };
  }

  if (!resolution.lastSeenAt || Date.now() - resolution.lastSeenAt.getTime() >= 5 * 60_000) {
    await queryRows(`UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [
      resolution.sessionId,
    ]);
  }

  const csrfToken = getCsrfToken(request) || createRandomToken(18);
  const expectedHash = hashOpaqueValue(csrfToken, env.AUTH_SESSION_SECRET);

  if (expectedHash !== resolution.csrfHash) {
    await queryRows(`UPDATE user_sessions SET csrf_secret_hash = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, [
      expectedHash,
      resolution.sessionId,
    ]);
  }

  appendCookie(response, env.CSRF_COOKIE_NAME, csrfToken, {
    ...COOKIE_OPTIONS,
    httpOnly: false,
  });

  return {
    authenticated: true,
    csrfToken,
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

    const sessionToken = createRandomToken();
    const csrfToken = createRandomToken(18);
    const sessionTokenHash = hashOpaqueValue(sessionToken, env.AUTH_SESSION_SECRET);
    const csrfTokenHash = hashOpaqueValue(csrfToken, env.AUTH_SESSION_SECRET);

    await queryRows(
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
        csrfTokenHash,
        rememberMe ? 1 : 0,
        request.ip,
        request.header('user-agent')?.trim() || null,
        null,
        rememberMe ? env.REMEMBER_ME_TTL_DAYS * 24 : env.SESSION_TTL_HOURS,
      ]
    );

    await queryRows(
      `UPDATE users SET last_login_at = UTC_TIMESTAMP(6), updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
      [actor.userId]
    );

    await clearSignInFailures(identifier);

    setSessionCookies(response, {
      csrfToken,
      rememberMe,
      sessionToken,
    });

    return {
      authenticated: true,
      csrfToken,
      user: toAdminSessionUser(actor),
    };
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
}) => {
  await consumeAuthRateLimits([
    {
      key: `password-reset-confirm:token:${payload.token.trim()}`,
      maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
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
    const csrfToken = getCsrfToken(request);
    if (!csrfToken || hashOpaqueValue(csrfToken, env.AUTH_SESSION_SECRET) !== resolution.csrfHash) {
      recordSecurityEventSafely({
        eventTypeCode: 'admin.csrf_mismatch',
        success: false,
        userId: resolution.actor.userId,
      });
      throw forbidden('csrf_mismatch', 'CSRF validation failed.');
    }
  }

  if (resolution.actor.mustRotatePassword && !options?.allowPasswordRotationRequired) {
    throw forbidden(
      'password_rotation_required',
      'Admin password rotation is required before accessing this resource.'
    );
  }

  return resolution.actor;
};
