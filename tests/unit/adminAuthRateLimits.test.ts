import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'admin_backend/src/modules/auth/service.ts'),
  'utf8'
);
const routes = readFileSync(resolve(process.cwd(), 'admin_backend/src/routes/auth.ts'), 'utf8');

const extractBlock = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

const extractRouteBlock = (source: string, route: string) => {
  const startIndex = source.indexOf(`'${route}'`);
  const nextRouteIndex = source.indexOf('authRouter.', startIndex + route.length);
  const endIndex = nextRouteIndex === -1 ? source.length : nextRouteIndex;

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('admin auth persistent rate limits', () => {
  it('limits sign-in by both normalized identifier and request IP before password verification', () => {
    const keyBlock = extractBlock(
      service,
      'const getSignInRateLimitKeys =',
      'const getPasswordResetDeliveryMode'
    );
    const signInBlock = extractBlock(service, 'export const signIn = async', 'const recordAdminMfaAudit');

    expect(keyBlock).toContain('signin:identifier');
    expect(keyBlock).toContain('signin:ip');
    expect(keyBlock).toContain('getRequestIpAddress(request)');
    expect(signInBlock.indexOf('await assertSignInAllowed(rateLimitKeys)')).toBeLessThan(
      signInBlock.indexOf('fetchActorByIdentifier(identifier)')
    );
    expect(signInBlock).toContain('await recordSignInFailure(rateLimitKeys)');
  });

  it('limits password reset request by identifier and IP', () => {
    const keyBlock = extractBlock(
      service,
      'const getPasswordResetRateLimitKeys =',
      'const consumeAuthRateLimits'
    );
    const resetRequestBlock = extractBlock(
      service,
      'export const requestPasswordReset = async',
      'export const resetPassword'
    );

    expect(keyBlock).toContain('password-reset:identifier');
    expect(keyBlock).toContain('password-reset:ip');
    expect(resetRequestBlock).toContain('consumeAuthRateLimits(getPasswordResetRateLimitKeys');
  });

  it('limits password reset confirm by token flow and IP without requiring CSRF', () => {
    const resetConfirmBlock = extractBlock(
      service,
      'export const resetPassword = async',
      'const resetToken = await fetchPasswordResetToken'
    );
    const routeBlock = extractRouteBlock(routes, '/auth/password-reset/confirm');

    expect(resetConfirmBlock).toContain('password-reset-confirm:token');
    expect(resetConfirmBlock).toContain('password-reset-confirm:ip');
    expect(routeBlock).toContain('ipAddress: getRequestIpAddress(request)');
    expect(routeBlock).not.toContain('requireCsrf');
  });
});
