import { env } from '../../config/env.js';
import {
  createNumericCode,
  createRandomToken,
  hashOneTimeCode,
  hashOpaqueValue,
  hashPassword,
  verifyPassword,
} from '../../lib/authCrypto.js';
import { notFound, conflict, tooManyRequests, unauthorized } from '../../lib/httpErrors.js';
import { getMysqlPool } from '../../lib/mysql.js';
import { createPublicId } from '../../lib/ids.js';
import { recordSecurityEvent } from '../../lib/securityEvents.js';
import { validateAddressForStorage } from '../../lib/addressValidation.js';
import { emailAuthProvider } from './providers/email.js';
import { googleAuthProvider } from './providers/google.js';
import { smsAuthProvider } from './providers/sms.js';
import { MysqlAuthStore } from './mysqlAuthStore.js';
import { consumeGoogleOAuthNonce, issueGoogleOAuthNonce } from './oauthNonceStore.js';
import { assertStrongClientPassword } from './passwordPolicy.js';
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  getPersistentRateLimitStatus,
} from './persistentRateLimiter.js';
import type {
  AuthAccountRecord,
  AuthFlowRecord,
  AuthFlowPurpose,
  AuthSessionUser,
  AuthStore,
  ChallengeType,
  PendingChallenge,
} from './types.js';
import type { GoogleIdentity } from './providers/types.js';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizePhone = (value: string) => value.replace(/\s+/g, ' ').trim();
const isEmailIdentifier = (value: string) => value.includes('@');
const nowIso = () => new Date().toISOString();
const addMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const addHours = (hours: number) => new Date(Date.now() + hours * 60 * 60_000).toISOString();
const addDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
const getWindowMs = () => env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000;
const PASSWORD_RESET_RESPONSE_FLOOR_MS = 700;
const PASSWORD_RESET_GENERIC_MESSAGE =
  'If an account exists for that identifier, password reset instructions will be sent.';
const CODE_ATTEMPT_LIMIT_MESSAGE = 'Too many invalid verification attempts. Request a new code.';
const isPreviewAccountEnabled = () => env.APP_ENV === 'development' && env.PREVIEW_ACCOUNT_ENABLED;
const isPreviewAccount = (account: AuthAccountRecord) =>
  normalizeEmail(account.email) === normalizeEmail(env.PREVIEW_ACCOUNT_EMAIL);
const canAuthenticateAccount = (account: AuthAccountRecord) =>
  !isPreviewAccount(account) || isPreviewAccountEnabled();

export const mergeGoogleIdentityWithAccount = (
  existingAccount: AuthAccountRecord | undefined,
  googleIdentity: GoogleIdentity,
  fallbackCountry = env.DEFAULT_PRICING_COUNTRY
) => {
  const normalizedGoogleEmail = normalizeEmail(googleIdentity.email);

  if (!existingAccount) {
    return {
      id: createPublicId(),
      fullName: googleIdentity.fullName,
      email: normalizedGoogleEmail,
      phone: '',
      country: fallbackCountry,
      oauthSubject: googleIdentity.subject,
      passwordHash: '',
      provider: 'google',
      isEmailVerified: googleIdentity.emailVerified,
      isPhoneVerified: false,
      createdAt: nowIso(),
    } satisfies AuthAccountRecord;
  }

  if (normalizeEmail(existingAccount.email) !== normalizedGoogleEmail) {
    throw conflict(
      'google_email_mismatch',
      'This Google account is linked to a different email. Verify the email change before using it to sign in.'
    );
  }

  return {
    ...existingAccount,
    country: existingAccount.country || fallbackCountry,
    email: existingAccount.email,
    fullName: existingAccount.fullName || googleIdentity.fullName,
    isEmailVerified: existingAccount.isEmailVerified || googleIdentity.emailVerified,
    oauthSubject: googleIdentity.subject,
    provider: 'google',
  } satisfies AuthAccountRecord;
};

const isMysqlConfigured = Boolean(
  env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER && env.MYSQL_PASSWORD
);

let storePromise: Promise<AuthStore> | null = null;
let initializationPromise: Promise<AuthStore> | null = null;

const toUser = (account: AuthAccountRecord): AuthSessionUser => ({
  avatar: '',
  email: account.email,
  id: account.id,
  joinedAt: account.createdAt,
  lastActiveAt: account.lastLoginAt || account.createdAt,
  lifecycle: 'client',
  name: account.fullName,
  owner: 'Client Intake Desk',
  phone: account.phone,
  region: account.country,
});

const createChallenge = (
  type: ChallengeType,
  ttlMinutes: number
) => {
  const code = createNumericCode();
  const challenge: PendingChallenge = {
    type,
    hashedCode: hashOneTimeCode(code, env.AUTH_SESSION_SECRET),
    expiresAt: addMinutes(ttlMinutes),
    lastSentAt: nowIso(),
  };

  return { challenge, code };
};

const issueEmailChallenge = async (
  email: string,
  fullName: string,
  ttlMinutes: number,
  purpose: 'email_verification' | 'password_reset'
) => {
  const challenge = createChallenge(
    purpose === 'password_reset' ? 'password-reset' : 'email',
    ttlMinutes
  );
  const delivery = await emailAuthProvider.sendCode({
    code: challenge.code,
    purpose,
    recipientEmail: email,
    recipientName: fullName,
  });

  return {
    challenge: challenge.challenge,
    deliveryHint: delivery.deliveryHint,
  };
};

const issuePhoneChallenge = async (phone: string) => {
  const expiresAt = addMinutes(env.PHONE_OTP_TTL_MINUTES);
  const lastSentAt = nowIso();

  if (env.SMS_PROVIDER_MODE !== 'twilio-verify') {
    const challenge = createChallenge('phone', env.PHONE_OTP_TTL_MINUTES);
    const delivery = await smsAuthProvider.sendCode({
      code: challenge.code,
      purpose: 'phone_verification',
      recipientPhone: phone,
    });

    return {
      challenge: {
        ...challenge.challenge,
        phoneSnapshot: phone,
        providerCode: env.SMS_PROVIDER_MODE === 'twilio' ? ('twilio' as const) : ('preview' as const),
      },
      deliveryHint: delivery.deliveryHint,
    };
  }

  const delivery = await smsAuthProvider.sendCode({
    purpose: 'phone_verification',
    recipientPhone: phone,
  });

  return {
    challenge: {
      type: 'phone' as const,
      expiresAt,
      lastSentAt,
      phoneSnapshot: phone,
      providerCode: 'twilio-verify' as const,
      providerReference: delivery.providerReference,
    },
    deliveryHint: delivery.deliveryHint,
  };
};

const consumeAuthRateLimit = async (options: { key: string; maxAttempts?: number }) => {
  const rateLimit = await consumePersistentRateLimit({
    key: options.key,
    maxAttempts: options.maxAttempts ?? env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    scope: 'client_auth',
    windowMs: getWindowMs(),
  });

  if (!rateLimit.allowed) {
    await recordSecurityEvent({
      eventTypeCode: 'client.rate_limit_blocked',
      identifierValue: options.key,
      success: false,
    });
    throw tooManyRequests(
      'too_many_attempts',
      'Too many attempts. Please wait before trying again.',
      rateLimit.retryAfterSeconds
    );
  }
};

const getClientAuthRateLimitKeys = (
  actionCode: 'password-reset' | 'signin' | 'signup',
  identifier: string,
  ipAddress: string
) => [
  {
    key: `${actionCode}:identifier:${identifier.trim().toLowerCase()}`,
    maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
  },
  {
    key: `${actionCode}:ip:${ipAddress || 'unknown'}`,
    maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
  },
];

const consumeClientAuthRateLimits = async (
  actionCode: 'password-reset' | 'signin' | 'signup',
  identifier: string,
  ipAddress: string
) => {
  for (const key of getClientAuthRateLimitKeys(actionCode, identifier, ipAddress)) {
    await consumeAuthRateLimit(key);
  }
};

const assertClientSignInAllowed = async (identifier: string, ipAddress: string) => {
  for (const key of getClientAuthRateLimitKeys('signin', identifier, ipAddress)) {
    const rateLimit = await getPersistentRateLimitStatus({
      key: key.key,
      maxAttempts: key.maxAttempts,
      scope: 'client_auth',
      windowMs: getWindowMs(),
    });

    if (!rateLimit.allowed) {
      await recordSecurityEvent({
        eventTypeCode: 'client.rate_limit_blocked',
        identifierValue: key.key,
        success: false,
      });
      throw tooManyRequests(
        'too_many_attempts',
        'Too many attempts. Please wait before trying again.',
        rateLimit.retryAfterSeconds
      );
    }
  }
};

const recordClientSignInFailure = async (identifier: string, ipAddress: string) => {
  for (const key of getClientAuthRateLimitKeys('signin', identifier, ipAddress)) {
    await consumePersistentRateLimit({
      key: key.key,
      maxAttempts: key.maxAttempts,
      scope: 'client_auth',
      windowMs: getWindowMs(),
    });
  }
};

const clearClientSignInFailures = async (identifier: string) => {
  await clearPersistentRateLimit({
    key: `signin:identifier:${identifier.trim().toLowerCase()}`,
    scope: 'client_auth',
  });
};

const isSmsDeliveryFailure = (error: unknown): error is Error & { code: string } =>
  error instanceof Error &&
  'code' in error &&
  ['sms_provider_failed', 'sms_provider_misconfigured', 'sms_provider_disabled'].includes(
    String((error as { code?: unknown }).code)
  );

const buildPhoneCaptureFallbackResult = async (
  store: AuthStore,
  account: AuthAccountRecord,
  purpose: AuthFlowPurpose,
  rememberMe: boolean,
  message: string
) => ({
  flowToken: await createFlow(store, account.id, purpose, rememberMe, {}),
  result: {
    status: 'phone_capture_required' as const,
    message,
    email: account.email,
    phone: account.phone,
  },
});

const createStore = async (): Promise<AuthStore> => {
  if (!isMysqlConfigured) {
    throw new Error('AUTH_STORE_MODE is mysql but MySQL environment variables are incomplete.');
  }

  const mysqlStore = new MysqlAuthStore(getMysqlPool());
  await mysqlStore.initialize();
  return mysqlStore;
};

const getStore = async () => {
  if (!storePromise) {
    storePromise = createStore().catch((error) => {
      storePromise = null;
      throw error;
    });
  }

  return storePromise;
};

const findAccountByIdentifier = async (store: AuthStore, identifier: string) => {
  if (isEmailIdentifier(identifier)) {
    return store.getAccountByEmail(normalizeEmail(identifier));
  }

  return store.getAccountByPhone(normalizePhone(identifier));
};

const createSession = async (
  store: AuthStore,
  account: AuthAccountRecord,
  rememberMe: boolean
) => {
  const rawSessionToken = createRandomToken();
  const hashedToken = hashOpaqueValue(rawSessionToken, env.AUTH_SESSION_SECRET);
  const timestamp = nowIso();
  const nextAccount = {
    ...account,
    lastLoginAt: timestamp,
  } satisfies AuthAccountRecord;

  await store.saveSession({
    accountId: account.id,
    createdAt: timestamp,
    expiresAt: rememberMe
      ? addDays(env.REMEMBER_ME_TTL_DAYS)
      : addHours(env.SESSION_TTL_HOURS),
    hashedToken,
    lastSeenAt: timestamp,
    rememberMe,
  });
  await store.saveAccount(nextAccount);

  return {
    clearFlowCookie: true,
    rememberMe,
    result: {
      status: 'authenticated' as const,
      message: 'Signed in successfully.',
      user: toUser(nextAccount),
    },
    sessionToken: rawSessionToken,
  };
};

const createFlow = async (
  store: AuthStore,
  accountId: string,
  purpose: AuthFlowPurpose,
  rememberMe: boolean,
  options: Partial<{
    emailChallenge: PendingChallenge;
    phoneChallenge: PendingChallenge;
    passwordResetChallenge: PendingChallenge;
  }>
) => {
  const rawFlowToken = createRandomToken();

  await store.saveFlow({
    accountId,
    createdAt: nowIso(),
    expiresAt: addMinutes(env.AUTH_FLOW_TTL_MINUTES),
    hashedToken: hashOpaqueValue(rawFlowToken, env.AUTH_SESSION_SECRET),
    purpose,
    rememberMe,
    ...options,
  });

  return rawFlowToken;
};

const readFlow = async (store: AuthStore, rawFlowToken: string | undefined) => {
  if (!rawFlowToken) {
    throw unauthorized('missing_auth_flow', 'No authentication flow is pending.');
  }

  const flow = await store.getFlowByHashedToken(
    hashOpaqueValue(rawFlowToken, env.AUTH_SESSION_SECRET)
  );

  if (!flow) {
    throw unauthorized('invalid_auth_flow', 'Authentication flow expired or is invalid.');
  }

  const account = await store.getAccountById(flow.accountId);

  if (!account) {
    throw notFound('account_not_found', 'Account not found.');
  }

  return { account, flow };
};

export const getClientAuthCodeMaxAttempts = () => env.AUTH_RATE_LIMIT_MAX_ATTEMPTS;

export const assertChallengeAttemptsAvailable = (
  challenge: PendingChallenge | undefined,
  errorCode = 'too_many_verification_attempts'
) => {
  if ((challenge?.attemptCount ?? 0) >= getClientAuthCodeMaxAttempts()) {
    throw tooManyRequests(errorCode, CODE_ATTEMPT_LIMIT_MESSAGE, env.AUTH_FLOW_TTL_MINUTES * 60);
  }
};

const recordFailedFlowChallengeAttempt = async (
  store: AuthStore,
  flow: AuthFlowRecord,
  challengeType: ChallengeType,
  errorCode = 'too_many_verification_attempts'
) => {
  const attemptCount = await store.incrementFlowChallengeAttempt(flow.hashedToken, challengeType);

  if (attemptCount >= getClientAuthCodeMaxAttempts()) {
    throw tooManyRequests(errorCode, CODE_ATTEMPT_LIMIT_MESSAGE, env.AUTH_FLOW_TTL_MINUTES * 60);
  }
};

export const verifyChallengeCodeWithAttemptTracking = async (input: {
  challenge: PendingChallenge | undefined;
  code: string;
  flow: AuthFlowRecord;
  invalidCode: { code: string; message: string };
  store: AuthStore;
}) => {
  const { challenge, code, flow, invalidCode, store } = input;

  if (!challenge) {
    throw unauthorized('missing_verification_step', 'Required verification step is not pending.');
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    throw unauthorized('expired_verification_step', 'Verification code expired. Request a new code.');
  }

  assertChallengeAttemptsAvailable(challenge);

  if (!challenge.hashedCode) {
    throw unauthorized(
      'missing_verification_code',
      'Verification code is not available for this step.'
    );
  }

  if (hashOneTimeCode(code.trim(), env.AUTH_SESSION_SECRET) !== challenge.hashedCode) {
    await recordFailedFlowChallengeAttempt(store, flow, challenge.type);
    throw unauthorized(invalidCode.code, invalidCode.message);
  }
};

const verifyPhoneChallenge = async (
  store: AuthStore,
  flow: AuthFlowRecord,
  accountPhone: string,
  code: string
) => {
  const challenge = flow.phoneChallenge;
  if (!challenge) {
    throw unauthorized('missing_verification_step', 'Required verification step is not pending.');
  }

  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    throw unauthorized('expired_verification_step', 'Verification code expired. Request a new code.');
  }

  assertChallengeAttemptsAvailable(challenge);

  if (challenge.providerCode === 'twilio-verify') {
    const verification = await smsAuthProvider.verifyCode({
      code: code.trim(),
      purpose: 'phone_verification',
      providerReference: challenge.providerReference,
      recipientPhone: challenge.phoneSnapshot || accountPhone,
    });

    if (!verification.approved) {
      await recordFailedFlowChallengeAttempt(store, flow, 'phone');
      throw unauthorized('invalid_phone_otp', 'The OTP you entered is invalid.');
    }

    return;
  }

  await verifyChallengeCodeWithAttemptTracking({
    challenge,
    code,
    flow,
    invalidCode: {
    code: 'invalid_phone_otp',
    message: 'The OTP you entered is invalid.',
    },
    store,
  });
};

const createPreviewAccount = async (store: AuthStore) => {
  if (!isPreviewAccountEnabled()) {
    return;
  }

  const existing = await store.getAccountByEmail(env.PREVIEW_ACCOUNT_EMAIL);

  if (existing) {
    return;
  }

  await store.saveAccount({
    id: createPublicId(),
    fullName: env.PREVIEW_ACCOUNT_NAME,
    email: normalizeEmail(env.PREVIEW_ACCOUNT_EMAIL),
    phone: normalizePhone(env.PREVIEW_ACCOUNT_PHONE),
    country: env.PREVIEW_ACCOUNT_COUNTRY,
    passwordHash: await hashPassword(env.PREVIEW_ACCOUNT_PASSWORD),
    provider: 'email',
    isEmailVerified: true,
    isPhoneVerified: true,
    createdAt: '2024-08-15T09:00:00.000Z',
    lastLoginAt: nowIso(),
  });
};

const waitForPasswordResetFloor = async (startedAt: number) => {
  const remainingMs = PASSWORD_RESET_RESPONSE_FLOOR_MS - (Date.now() - startedAt);

  if (remainingMs > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, remainingMs);
    });
  }
};

const ensureInitialized = async () => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const store = await getStore();
      await createPreviewAccount(store);
      return store;
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
};

export const authService = {
  async getSession(rawSessionToken: string | undefined) {
    const store = await ensureInitialized();

    if (!rawSessionToken) {
      return {
        clearSessionCookie: false,
        user: null,
      };
    }

    const hashedToken = hashOpaqueValue(rawSessionToken, env.AUTH_SESSION_SECRET);
    const session = await store.getSessionByHashedToken(hashedToken);

    if (!session) {
      return {
        clearSessionCookie: true,
        user: null,
      };
    }

    const account = await store.getAccountById(session.accountId);

    if (!account) {
      await store.deleteSessionByHashedToken(hashedToken);
      return {
        clearSessionCookie: true,
        user: null,
      };
    }

    if (!canAuthenticateAccount(account)) {
      await store.deleteSessionByHashedToken(hashedToken);
      return {
        clearSessionCookie: true,
        user: null,
      };
    }

    return {
      clearSessionCookie: false,
      user: toUser(account),
    };
  },

  async signIn(
    payload: { identifier: string; password: string; rememberMe: boolean },
    context: { ipAddress: string }
  ) {
    const store = await ensureInitialized();
    const identifier = payload.identifier.trim();

    await assertClientSignInAllowed(identifier, context.ipAddress);

    const account = await findAccountByIdentifier(store, identifier);

    if (!account) {
      await recordSecurityEvent({
        eventTypeCode: 'client.login_failed',
        identifierValue: identifier.trim().toLowerCase(),
        ipAddress: context.ipAddress,
        success: false,
      });
      await recordClientSignInFailure(identifier, context.ipAddress);
      throw unauthorized('invalid_credentials', 'Invalid credentials. Please try again.');
    }

    if (!canAuthenticateAccount(account)) {
      await recordSecurityEvent({
        eventTypeCode: 'client.login_failed',
        identifierValue: identifier.trim().toLowerCase(),
        ipAddress: context.ipAddress,
        success: false,
      });
      await recordClientSignInFailure(identifier, context.ipAddress);
      throw unauthorized('invalid_credentials', 'Invalid credentials. Please try again.');
    }

    if (!account.passwordHash) {
      throw conflict(
        'use_google_sign_in',
        'This account uses Google sign-in. Continue with Google to access it.'
      );
    }

    const passwordMatches = await verifyPassword(payload.password, account.passwordHash);

    if (!passwordMatches) {
      await recordSecurityEvent({
        eventTypeCode: 'client.login_failed',
        identifierValue: identifier.trim().toLowerCase(),
        ipAddress: context.ipAddress,
        success: false,
      });
      await recordClientSignInFailure(identifier, context.ipAddress);
      throw unauthorized('invalid_credentials', 'Invalid credentials. Please try again.');
    }

    await clearClientSignInFailures(identifier);

    if (!account.isEmailVerified) {
      const emailChallenge = await issueEmailChallenge(
        account.email,
        account.fullName,
        env.EMAIL_VERIFICATION_TTL_MINUTES,
        'email_verification'
      );

      return {
        flowToken: await createFlow(store, account.id, 'sign-in', payload.rememberMe, {
          emailChallenge: emailChallenge.challenge,
        }),
        result: {
          status: 'email_verification_required' as const,
          message: 'Account not verified. Complete email verification to continue.',
          deliveryHint: emailChallenge.deliveryHint,
          email: account.email,
        },
      };
    }

    if (!account.isPhoneVerified) {
      try {
        const phoneChallenge = await issuePhoneChallenge(account.phone);

        return {
          flowToken: await createFlow(store, account.id, 'sign-in', payload.rememberMe, {
            phoneChallenge: phoneChallenge.challenge,
          }),
          result: {
            status: 'phone_otp_required' as const,
            message: 'Phone verification is required before login.',
            deliveryHint: phoneChallenge.deliveryHint,
            email: account.email,
            phone: account.phone,
          },
        };
      } catch (error) {
        if (isSmsDeliveryFailure(error)) {
          return buildPhoneCaptureFallbackResult(
            store,
            account,
            'sign-in',
            payload.rememberMe,
            'We could not deliver an OTP to the saved phone number. Update the phone number to continue.'
          );
        }

        throw error;
      }
    }

    return createSession(store, account, payload.rememberMe);
  },

  async signUp(payload: {
    acceptTerms: boolean;
    address: {
      city: string;
      country: string;
      line1: string;
      line2?: string | null;
      postalCode: string;
      sourceCode?: 'google' | 'ip_prefill' | 'manual';
      state: string;
      googlePlaceId?: string | null;
      validationStatusCode?: 'manual' | 'unverified' | 'verified';
    };
    country: string;
    email: string;
    fullName: string;
    password: string;
    phone: string;
  }, context: { ipAddress: string; userAgent?: string | null }) {
    const store = await ensureInitialized();
    const normalizedEmail = normalizeEmail(payload.email);
    const normalizedPhone = normalizePhone(payload.phone);

    await consumeClientAuthRateLimits('signup', normalizedEmail, context.ipAddress);

    if (await store.getAccountByEmail(normalizedEmail)) {
      throw conflict('email_already_exists', 'An account with this email already exists.');
    }

    if (await store.getAccountByPhone(normalizedPhone)) {
      throw conflict('phone_already_exists', 'An account with this phone number already exists.');
    }

    assertStrongClientPassword(payload.password, {
      email: normalizedEmail,
      fullName: payload.fullName,
    });

    const account: AuthAccountRecord = {
      id: createPublicId(),
      fullName: payload.fullName.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      country: (payload.address.country || payload.country).trim(),
      passwordHash: await hashPassword(payload.password),
      provider: 'email',
      isEmailVerified: false,
      isPhoneVerified: false,
      createdAt: nowIso(),
    };

    const primaryAddress = await validateAddressForStorage(payload.address);

    await store.saveAccount(account, {
      legalAcceptance: payload.acceptTerms
        ? {
            acceptanceTypeCode: 'terms_and_privacy',
            acceptedAt: nowIso(),
            ipAddress: context.ipAddress,
            sourceCode: 'portal_sign_up',
            userAgent: context.userAgent || null,
          }
        : undefined,
      primaryAddress,
    });

    const emailChallenge = await issueEmailChallenge(
      account.email,
      account.fullName,
      env.EMAIL_VERIFICATION_TTL_MINUTES,
      'email_verification'
    );

    return {
      flowToken: await createFlow(store, account.id, 'sign-up', false, {
        emailChallenge: emailChallenge.challenge,
      }),
      result: {
        status: 'email_verification_required' as const,
        message: 'Verification email sent. Complete email verification to continue.',
        deliveryHint: emailChallenge.deliveryHint,
        email: account.email,
        phone: account.phone,
      },
    };
  },

  async issueGoogleSignInNonce() {
    return issueGoogleOAuthNonce();
  },

  async signInWithGoogle(payload: { credential?: string; nonce?: string; rememberMe: boolean }) {
    const store = await ensureInitialized();
    await consumeGoogleOAuthNonce(payload.nonce);
    const googleIdentity = await googleAuthProvider.resolveIdentity(payload.credential, {
      nonce: payload.nonce,
    });
    const normalizedEmail = normalizeEmail(googleIdentity.email);
    const existingBySubject = await store.getAccountByOAuthSubject('google', googleIdentity.subject);
    const existingByEmail = await store.getAccountByEmail(normalizedEmail);

    if (existingBySubject && existingByEmail && existingBySubject.id !== existingByEmail.id) {
      throw conflict(
        'google_identity_conflict',
        'This Google account is already linked to another portal account.'
      );
    }

    const account = mergeGoogleIdentityWithAccount(
      existingBySubject || existingByEmail,
      googleIdentity
    );

    await store.saveAccount(account);

    if (!account.phone) {
      return {
        flowToken: await createFlow(store, account.id, 'google', payload.rememberMe, {}),
        result: {
          status: 'phone_capture_required' as const,
          message:
            'Google provided a verified email but no phone number. Add a phone number to continue.',
          email: account.email,
        },
      };
    }

    if (!account.isPhoneVerified) {
      try {
        const phoneChallenge = await issuePhoneChallenge(account.phone);

        return {
          flowToken: await createFlow(store, account.id, 'google', payload.rememberMe, {
            phoneChallenge: phoneChallenge.challenge,
          }),
          result: {
            status: 'phone_otp_required' as const,
            message: 'Phone OTP is required to complete Google sign-in.',
            deliveryHint: phoneChallenge.deliveryHint,
            email: account.email,
            phone: account.phone,
          },
        };
      } catch (error) {
        if (isSmsDeliveryFailure(error)) {
          return buildPhoneCaptureFallbackResult(
            store,
            account,
            'google',
            payload.rememberMe,
            'We could not deliver an OTP to the saved phone number. Update the phone number to continue.'
          );
        }

        throw error;
      }
    }

    return createSession(store, account, payload.rememberMe);
  },

  async verifyEmail(rawFlowToken: string | undefined, code: string) {
    const store = await ensureInitialized();
    const { account, flow } = await readFlow(store, rawFlowToken);

    await verifyChallengeCodeWithAttemptTracking({
      challenge: flow.emailChallenge,
      code,
      flow,
      invalidCode: {
        code: 'invalid_email_verification_code',
        message: 'The verification code is invalid.',
      },
      store,
    });

    const updatedAccount = {
      ...account,
      isEmailVerified: true,
    } satisfies AuthAccountRecord;

    await store.saveAccount(updatedAccount);

    let phoneChallenge;
    try {
      phoneChallenge = await issuePhoneChallenge(updatedAccount.phone);
    } catch (error) {
      if (isSmsDeliveryFailure(error)) {
        await store.deleteFlowByHashedToken(flow.hashedToken);

        return {
          flowToken: await createFlow(store, updatedAccount.id, flow.purpose, flow.rememberMe, {}),
          clearFlowCookie: true,
          result: {
            status: 'phone_capture_required' as const,
            message:
              'Email verified, but we could not deliver an OTP to the saved phone number. Update the phone number to continue.',
            email: updatedAccount.email,
            phone: updatedAccount.phone,
          },
        };
      }

      throw error;
    }

    await store.deleteFlowByHashedToken(flow.hashedToken);

    return {
      flowToken: await createFlow(store, updatedAccount.id, flow.purpose, flow.rememberMe, {
        phoneChallenge: phoneChallenge.challenge,
      }),
      clearFlowCookie: true,
      result: {
        status: 'phone_otp_required' as const,
        message: 'Email verified. Complete phone OTP verification to continue.',
        deliveryHint: phoneChallenge.deliveryHint,
        email: updatedAccount.email,
        phone: updatedAccount.phone,
      },
    };
  },

  async submitGooglePhone(
    rawFlowToken: string | undefined,
    phone: string,
    country: string
  ) {
    const store = await ensureInitialized();
    const { account, flow } = await readFlow(store, rawFlowToken);

    if (flow.purpose === 'password-reset') {
      throw unauthorized('invalid_auth_flow', 'Phone update is not pending.');
    }

    const normalizedPhone = normalizePhone(phone);
    const existingByPhone = await store.getAccountByPhone(normalizedPhone);

    if (existingByPhone && existingByPhone.id !== account.id) {
      throw conflict('phone_already_exists', 'An account with this phone number already exists.');
    }

    const updatedAccount = {
      ...account,
      phone: normalizedPhone,
      country: country.trim(),
    } satisfies AuthAccountRecord;

    await store.saveAccount(updatedAccount);

    let phoneChallenge;
    try {
      phoneChallenge = await issuePhoneChallenge(updatedAccount.phone);
    } catch (error) {
      if (isSmsDeliveryFailure(error)) {
        await store.deleteFlowByHashedToken(flow.hashedToken);

        return {
          flowToken: await createFlow(store, updatedAccount.id, flow.purpose, flow.rememberMe, {}),
          clearFlowCookie: true,
          result: {
            status: 'phone_capture_required' as const,
            message:
              'We could not deliver an OTP to that phone number. Update the phone number and try again.',
            email: updatedAccount.email,
            phone: updatedAccount.phone,
          },
        };
      }

      throw error;
    }

    await store.deleteFlowByHashedToken(flow.hashedToken);

    return {
      flowToken: await createFlow(store, updatedAccount.id, flow.purpose, flow.rememberMe, {
        phoneChallenge: phoneChallenge.challenge,
      }),
      clearFlowCookie: true,
      result: {
        status: 'phone_otp_required' as const,
        message: 'Phone number saved. Enter the OTP to continue.',
        deliveryHint: phoneChallenge.deliveryHint,
        email: updatedAccount.email,
        phone: updatedAccount.phone,
      },
    };
  },

  async verifyPhoneOtp(rawFlowToken: string | undefined, code: string) {
    const store = await ensureInitialized();
    const { account, flow } = await readFlow(store, rawFlowToken);

    await verifyPhoneChallenge(store, flow, account.phone, code);

    const updatedAccount = {
      ...account,
      isEmailVerified: true,
      isPhoneVerified: true,
    } satisfies AuthAccountRecord;

    await store.saveAccount(updatedAccount);
    await store.deleteFlowByHashedToken(flow.hashedToken);

    return createSession(store, updatedAccount, flow.rememberMe);
  },

  async requestPasswordReset(identifier: string, context: { ipAddress: string }) {
    const startedAt = Date.now();
    const store = await ensureInitialized();
    const normalizedIdentifier = identifier.trim().toLowerCase();

    await consumeClientAuthRateLimits(
      'password-reset',
      normalizedIdentifier,
      context.ipAddress
    );

    const account = await findAccountByIdentifier(store, identifier);
    const resettableAccount =
      account && canAuthenticateAccount(account) ? account : undefined;
    let flowToken = createRandomToken();

    await recordSecurityEvent({
      eventTypeCode: 'client.password_reset_requested',
      identifierValue: normalizedIdentifier,
      ipAddress: context.ipAddress,
      success: true,
    });

    if (resettableAccount) {
      try {
        const challenge = await issueEmailChallenge(
          resettableAccount.email,
          resettableAccount.fullName,
          env.PASSWORD_RESET_TTL_MINUTES,
          'password_reset'
        );

        flowToken = await createFlow(store, resettableAccount.id, 'password-reset', false, {
          passwordResetChallenge: challenge.challenge,
        });
      } catch {
        flowToken = createRandomToken();
      }
    }

    await waitForPasswordResetFloor(startedAt);

    return {
      flowToken,
      status: 'password_reset_requested' as const,
      message: PASSWORD_RESET_GENERIC_MESSAGE,
    };
  },

  async resetPassword(
    rawFlowToken: string | undefined,
    payload: { code: string; email: string; password: string }
  ) {
    const store = await ensureInitialized();
    let account: AuthAccountRecord;
    let flow: AuthFlowRecord;

    try {
      ({ account, flow } = await readFlow(store, rawFlowToken));
    } catch {
      throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
    }

    if (!canAuthenticateAccount(account)) {
      throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
    }

    if (flow.purpose !== 'password-reset') {
      throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
    }

    if (normalizeEmail(payload.email) !== normalizeEmail(account.email)) {
      await recordFailedFlowChallengeAttempt(
        store,
        flow,
        'password-reset',
        'too_many_reset_attempts'
      );
      throw unauthorized('invalid_reset_code', 'The reset code is invalid or expired.');
    }

    await verifyChallengeCodeWithAttemptTracking({
      challenge: flow.passwordResetChallenge,
      code: payload.code,
      flow,
      invalidCode: {
        code: 'invalid_reset_code',
        message: 'The reset code is invalid or expired.',
      },
      store,
    });

    assertStrongClientPassword(payload.password, {
      email: account.email,
      fullName: account.fullName,
    });

    await store.saveAccount({
      ...account,
      passwordHash: await hashPassword(payload.password),
    });
    await store.deleteFlowByHashedToken(flow.hashedToken);
    await store.deleteSessionsByAccountId(account.id);
    await recordSecurityEvent({
      eventTypeCode: 'client.password_reset_completed',
      identifierValue: normalizeEmail(account.email),
      success: true,
    });

    return {
      clearFlowCookie: true,
      clearSessionCookie: true,
      result: {
        status: 'password_reset_completed' as const,
        message: 'Password reset successful. You can sign in now.',
        email: account.email,
      },
    };
  },

  async resendEmailVerification(rawFlowToken: string | undefined) {
    const store = await ensureInitialized();
    const { account, flow } = await readFlow(store, rawFlowToken);

    const emailChallenge = await issueEmailChallenge(
      account.email,
      account.fullName,
      env.EMAIL_VERIFICATION_TTL_MINUTES,
      'email_verification'
    );

    await store.deleteFlowByHashedToken(flow.hashedToken);

    return {
      flowToken: await createFlow(store, account.id, flow.purpose, flow.rememberMe, {
        emailChallenge: emailChallenge.challenge,
      }),
      clearFlowCookie: true,
      result: {
        status: 'email_verification_required' as const,
        message: 'Verification email resent.',
        deliveryHint: emailChallenge.deliveryHint,
        email: account.email,
      },
    };
  },

  async resendPhoneOtp(rawFlowToken: string | undefined) {
    const store = await ensureInitialized();
    const { account, flow } = await readFlow(store, rawFlowToken);

    const phoneChallenge = await issuePhoneChallenge(account.phone);

    await store.deleteFlowByHashedToken(flow.hashedToken);

    return {
      flowToken: await createFlow(store, account.id, flow.purpose, flow.rememberMe, {
        phoneChallenge: phoneChallenge.challenge,
      }),
      clearFlowCookie: true,
      result: {
        status: 'phone_otp_required' as const,
        message: 'OTP resent.',
        deliveryHint: phoneChallenge.deliveryHint,
        email: account.email,
        phone: account.phone,
      },
    };
  },

  async resendPasswordReset(rawFlowToken: string | undefined) {
    const startedAt = Date.now();
    const store = await ensureInitialized();
    let flowToken = createRandomToken();

    try {
      const { account, flow } = await readFlow(store, rawFlowToken);

      if (flow.purpose === 'password-reset' && canAuthenticateAccount(account)) {
        try {
          const challenge = await issueEmailChallenge(
            account.email,
            account.fullName,
            env.PASSWORD_RESET_TTL_MINUTES,
            'password_reset'
          );

          await store.deleteFlowByHashedToken(flow.hashedToken);
          flowToken = await createFlow(store, account.id, 'password-reset', false, {
            passwordResetChallenge: challenge.challenge,
          });
        } catch {
          flowToken = createRandomToken();
        }
      }
    } catch {
      flowToken = createRandomToken();
    }

    await waitForPasswordResetFloor(startedAt);

    return {
      flowToken,
      clearFlowCookie: true,
      result: {
        status: 'password_reset_requested' as const,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      },
    };
  },

  async signOut(rawSessionToken: string | undefined) {
    const store = await ensureInitialized();

    if (!rawSessionToken) {
      return;
    }

    await store.deleteSessionByHashedToken(
      hashOpaqueValue(rawSessionToken, env.AUTH_SESSION_SECRET)
    );
  },
};
