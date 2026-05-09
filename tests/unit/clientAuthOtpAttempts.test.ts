import { beforeAll, describe, expect, it } from 'vitest';
import { hashOneTimeCode } from '../../backend/src/lib/authCrypto.js';
import type {
  AuthFlowRecord,
  AuthStore,
  ChallengeType,
  PendingChallenge,
} from '../../backend/src/modules/auth/types.js';

const secret = 'test-client-auth-session-secret-with-enough-length';

let verifyChallengeCodeWithAttemptTracking: typeof import('../../backend/src/modules/auth/authService.js')['verifyChallengeCodeWithAttemptTracking'];
let getClientAuthCodeMaxAttempts: typeof import('../../backend/src/modules/auth/authService.js')['getClientAuthCodeMaxAttempts'];

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET = secret;
  process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS = '5';
  process.env.AUTH_FLOW_TTL_MINUTES = '30';
  ({ getClientAuthCodeMaxAttempts, verifyChallengeCodeWithAttemptTracking } = await import(
    '../../backend/src/modules/auth/authService.js'
  ));
});

const futureIso = () => new Date(Date.now() + 10 * 60_000).toISOString();

const createFlow = (challengeType: ChallengeType): AuthFlowRecord => ({
  accountId: 'client-test-account',
  createdAt: new Date().toISOString(),
  expiresAt: futureIso(),
  hashedToken: `hashed-flow-token-${challengeType}`,
  purpose: challengeType === 'password-reset' ? 'password-reset' : 'sign-up',
  rememberMe: false,
});

const createChallenge = (
  type: ChallengeType,
  code = '123456',
  attemptCount = 0
): PendingChallenge => ({
  attemptCount,
  expiresAt: futureIso(),
  hashedCode: hashOneTimeCode(code, secret),
  lastSentAt: new Date().toISOString(),
  type,
});

const createStore = (onIncrement: (challengeType: ChallengeType) => number): AuthStore =>
  ({
    deleteFlowByHashedToken: async () => undefined,
    deleteSessionByHashedToken: async () => undefined,
    deleteSessionsByAccountId: async () => undefined,
    getAccountByEmail: async () => undefined,
    getAccountById: async () => undefined,
    getAccountByOAuthSubject: async () => undefined,
    getAccountByPhone: async () => undefined,
    getFlowByHashedToken: async () => undefined,
    getSessionByHashedToken: async () => undefined,
    incrementFlowChallengeAttempt: async (_hashedToken, challengeType) => onIncrement(challengeType),
    initialize: async () => undefined,
    saveAccount: async () => undefined,
    saveFlow: async () => undefined,
    saveSession: async () => undefined,
  }) satisfies AuthStore;

const expectWrongCodeIncrements = async (
  challengeType: ChallengeType,
  errorCode: string
) => {
  let attempts = 0;
  const flow = createFlow(challengeType);
  const challenge = createChallenge(challengeType);
  const store = createStore((type) => {
    expect(type).toBe(challengeType);
    attempts += 1;
    return attempts;
  });

  await expect(
    verifyChallengeCodeWithAttemptTracking({
      challenge,
      code: '000000',
      flow,
      invalidCode: {
        code: errorCode,
        message: 'Invalid code.',
      },
      store,
    })
  ).rejects.toMatchObject({ code: errorCode });

  expect(attempts).toBe(1);
};

describe('client auth verification attempt counters', () => {
  it('increments attempts for a wrong email verification code', async () => {
    await expectWrongCodeIncrements('email', 'invalid_email_verification_code');
  });

  it('increments attempts for a wrong phone OTP code', async () => {
    await expectWrongCodeIncrements('phone', 'invalid_phone_otp');
  });

  it('increments attempts for a wrong password reset code', async () => {
    await expectWrongCodeIncrements('password-reset', 'invalid_reset_code');
  });

  it('rejects a correct code after max attempts', async () => {
    let attempts = 0;
    const flow = createFlow('email');
    const challenge = createChallenge('email', '123456', getClientAuthCodeMaxAttempts());
    const store = createStore(() => {
      attempts += 1;
      return attempts;
    });

    await expect(
      verifyChallengeCodeWithAttemptTracking({
        challenge,
        code: '123456',
        flow,
        invalidCode: {
          code: 'invalid_email_verification_code',
          message: 'Invalid code.',
        },
        store,
      })
    ).rejects.toMatchObject({ code: 'too_many_verification_attempts' });

    expect(attempts).toBe(0);
  });

  it('accepts a correct code before max attempts without incrementing attempts', async () => {
    let attempts = 0;
    const flow = createFlow('phone');
    const challenge = createChallenge('phone', '123456', getClientAuthCodeMaxAttempts() - 1);
    const store = createStore(() => {
      attempts += 1;
      return attempts;
    });

    await expect(
      verifyChallengeCodeWithAttemptTracking({
        challenge,
        code: '123456',
        flow,
        invalidCode: {
          code: 'invalid_phone_otp',
          message: 'Invalid code.',
        },
        store,
      })
    ).resolves.toBeUndefined();

    expect(attempts).toBe(0);
  });
});
