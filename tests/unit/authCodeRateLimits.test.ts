import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const authRoutes = readFileSync(resolve(process.cwd(), 'backend/src/routes/auth.ts'), 'utf8');
const meRoutes = readFileSync(resolve(process.cwd(), 'backend/src/routes/me.ts'), 'utf8');
const authService = readFileSync(
  resolve(process.cwd(), 'backend/src/modules/auth/authService.ts'),
  'utf8'
);

const extractBlock = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

const extractRouteBlock = (source: string, route: string, routerName: string) => {
  const startIndex = source.indexOf(`'${route}'`);
  const nextRouteIndex = source.indexOf(`${routerName}.`, startIndex + route.length);
  const endIndex = nextRouteIndex === -1 ? source.length : nextRouteIndex;

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('client auth code send and resend rate limits', () => {
  it('does not create a global shared missing-flow bucket', () => {
    const block = extractBlock(
      authRoutes,
      'const consumeAuthActionRateLimit = async',
      'const setSessionCookie ='
    );

    expect(block).not.toContain("flowToken ? hashOpaqueValue(flowToken, env.AUTH_SESSION_SECRET) : 'missing'");
    expect(block).not.toContain(':flow:missing');
    expect(block).toContain('if (flowToken)');
    expect(block).toContain("key: `${actionCode}:ip:${getRequestIpAddress(request)}`");
    expect(block).toContain("key: `${actionCode}:flow:${hashOpaqueValue(flowToken, env.AUTH_SESSION_SECRET)}`");
  });

  it('rate-limits auth resend, send, and confirm routes before provider or verification work', () => {
    const routeExpectations = [
      ['/auth/verify-email', 'email-verification-verify'],
      ['/auth/google/nonce', 'google-nonce'],
      ['/auth/google/phone', 'phone-otp-send'],
      ['/auth/verify-phone-otp', 'phone-otp-verify'],
      ['/auth/password-reset/confirm', 'password-reset-confirm'],
      ['/auth/email-verification/resend', 'email-verification-resend'],
      ['/auth/phone-otp/resend', 'phone-otp-resend'],
      ['/auth/password-reset/resend', 'password-reset-resend'],
    ] as const;

    for (const [route, action] of routeExpectations) {
      const block = extractRouteBlock(authRoutes, route, 'authRouter');
      expect(block).toContain(`'${action}'`);
      expect(block.indexOf('consumeAuthActionRateLimit')).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps password reset request rate-limited by identifier and IP in the service layer', () => {
    const block = extractBlock(
      authService,
      'async requestPasswordReset(identifier: string',
      'async resetPassword('
    );

    expect(block).toMatch(/consumeClientAuthRateLimits\(\s*'password-reset'/);
    expect(block).toContain('identifier');
  });

  it('rate-limits account email and phone change code routes with per-user and per-identifier buckets', () => {
    const helperBlock = extractBlock(
      meRoutes,
      'const consumeAccountCodeRateLimit = async',
      "meRouter.get(\n  '/me/preferences'"
    );

    expect(helperBlock).toContain("scope: 'client_account_codes'");
    expect(helperBlock).toContain("key: `${actionCode}:ip:${getRequestIpAddress(request)}`");
    expect(helperBlock).toContain("key: `${actionCode}:user:${userPublicId}`");
    expect(helperBlock).toContain('user-identifier');

    const routeExpectations = [
      ['/me/account/email-change/request', 'email-change-request'],
      ['/me/account/email-change/confirm', 'email-change-confirm'],
      ['/me/account/phone-change/request', 'phone-change-request'],
      ['/me/account/phone-change/confirm', 'phone-change-confirm'],
    ] as const;

    for (const [route, action] of routeExpectations) {
      const block = extractRouteBlock(meRoutes, route, 'meRouter');
      expect(block).toContain(`'${action}'`);
      expect(block).toContain('consumeAccountCodeRateLimit');
    }
  });
});
