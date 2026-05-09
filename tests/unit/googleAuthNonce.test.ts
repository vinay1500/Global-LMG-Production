import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const loadGoogleProvider = async () => {
  vi.resetModules();
  process.env.APP_ENV = 'development';
  process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret-with-enough-length';
  process.env.GOOGLE_AUTH_MODE = 'google-jwt';
  process.env.GOOGLE_CLIENT_ID = 'google-client-id.apps.googleusercontent.com';

  return import('../../backend/src/modules/auth/providers/google.js');
};

const loadOAuthNonceStore = async () => {
  vi.resetModules();
  process.env.APP_ENV = 'development';
  process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret-with-enough-length';

  return import('../../backend/src/modules/auth/oauthNonceStore.js');
};

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('Google ID token nonce validation', () => {
  const validPayload = (nonce = 'nonce-from-backend-123') => ({
    aud: 'google-client-id.apps.googleusercontent.com',
    email: 'Client@Example.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: 'https://accounts.google.com',
    name: 'Client Example',
    nonce,
    sub: 'google-subject-123',
  });

  it('accepts a Google payload with a matching nonce', async () => {
    const { verifyGoogleTokenPayload } = await loadGoogleProvider();

    expect(
      verifyGoogleTokenPayload(validPayload(), 'nonce-from-backend-123')
    ).toMatchObject({
      email: 'client@example.com',
      emailVerified: true,
      fullName: 'Client Example',
      subject: 'google-subject-123',
    });
  });

  it('rejects missing or wrong nonce claims', async () => {
    const { verifyGoogleTokenPayload } = await loadGoogleProvider();

    expect(() =>
      verifyGoogleTokenPayload({ ...validPayload(), nonce: undefined }, 'nonce-from-backend-123')
    ).toThrowError(expect.objectContaining({ code: 'google_nonce_missing' }));

    expect(() =>
      verifyGoogleTokenPayload(validPayload('different-nonce'), 'nonce-from-backend-123')
    ).toThrowError(expect.objectContaining({ code: 'google_nonce_mismatch' }));
  });

  it('keeps issuer, expiry, audience, and email verification checks enforced', async () => {
    const { verifyGoogleTokenPayload } = await loadGoogleProvider();

    expect(() =>
      verifyGoogleTokenPayload(
        { ...validPayload(), aud: 'other-client.apps.googleusercontent.com' },
        'nonce-from-backend-123'
      )
    ).toThrowError(expect.objectContaining({ code: 'google_audience_invalid' }));

    expect(() =>
      verifyGoogleTokenPayload(
        { ...validPayload(), iss: 'https://malicious.example' },
        'nonce-from-backend-123'
      )
    ).toThrowError(expect.objectContaining({ code: 'google_issuer_invalid' }));

    expect(() =>
      verifyGoogleTokenPayload(
        { ...validPayload(), exp: Math.floor(Date.now() / 1000) - 1 },
        'nonce-from-backend-123'
      )
    ).toThrowError(expect.objectContaining({ code: 'google_token_expired' }));

    expect(() =>
      verifyGoogleTokenPayload(
        { ...validPayload(), email_verified: false },
        'nonce-from-backend-123'
      )
    ).toThrowError(expect.objectContaining({ code: 'google_email_unverified' }));
  });
});

describe('Google OAuth nonce one-time storage guard', () => {
  it('treats consumed nonce rows as unusable so replay is rejected', async () => {
    const { isOAuthNonceRowUsable } = await loadOAuthNonceStore();
    const nowMs = Date.now();

    expect(
      isOAuthNonceRowUsable(
        {
          consumed_at: null,
          expires_at: new Date(nowMs + 60_000).toISOString(),
          id: 1,
        } as never,
        nowMs
      )
    ).toBe(true);

    expect(
      isOAuthNonceRowUsable(
        {
          consumed_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + 60_000).toISOString(),
          id: 1,
        } as never,
        nowMs
      )
    ).toBe(false);

    expect(
      isOAuthNonceRowUsable(
        {
          consumed_at: null,
          expires_at: new Date(nowMs - 1_000).toISOString(),
          id: 1,
        } as never,
        nowMs
      )
    ).toBe(false);
  });

  it('locks and consumes nonce rows during verification', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'backend/src/modules/auth/oauthNonceStore.ts'),
      'utf8'
    );

    expect(source).toContain('FOR UPDATE');
    expect(source).toContain('consumed_at = UTC_TIMESTAMP(6)');
  });
});
