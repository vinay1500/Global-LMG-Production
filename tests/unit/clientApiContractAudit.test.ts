import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('client API contract audit guards', () => {
  it('keeps dashboard request submission idempotency mandatory on both sides', () => {
    const dashboardRoutes = read('backend/src/routes/dashboard.ts');
    const dashboardApi = read('frontend/src/app/lib/api/dashboard.ts');

    expect(dashboardRoutes).toContain('requireIdempotencyKey');
    expect(dashboardRoutes).toContain('Idempotency-Key header is required to submit a request.');
    expect(dashboardApi).toContain("createIdempotencyIdentity('request-submit'");
    expect(dashboardApi).toContain('PAYMENT_IDEMPOTENCY_TTL_MS');
  });

  it('binds email-change confirmation to the stored pending flow target', () => {
    const repository = read('backend/src/modules/clientAccounts/repository.ts');
    const confirmBlock = repository.slice(
      repository.indexOf('public async confirmEmailChange'),
      repository.indexOf('public async requestPhoneChange')
    );

    expect(confirmBlock).toContain('email_snapshot');
    expect(confirmBlock).toContain("purpose_code = 'email_change'");
    expect(confirmBlock).toContain("normalizeEmail(token.email_snapshot || '') !== email");
  });

  it('keeps client payment and refund list APIs owned by the current client account', () => {
    const meRoutes = read('backend/src/routes/me.ts');
    const repository = read('backend/src/modules/domain/repository.ts');

    expect(meRoutes).toContain("meRouter.get(\n  '/me/payments'");
    expect(meRoutes).toContain("meRouter.get(\n  '/me/refunds'");
    expect(meRoutes).toContain('domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!)');
    expect(repository).toContain("${clientAccountId ? 'AND pt.client_account_id = ?' : ''}");
    expect(repository).not.toContain('provider_error');
  });

  it('documents direct /me endpoints as retained client API and exposes helpers for payment/refund reads', () => {
    const docs = read('docs/client-api-contract-notes.md');
    const endpoints = read('frontend/src/app/lib/api/endpoints.ts');
    const api = read('frontend/src/app/lib/api/dashboard.ts');

    expect(docs).toContain('direct authenticated `/me/*` endpoints are retained');
    expect(docs).toContain('GET /me/refunds');
    expect(endpoints).toContain("payments: () => joinApiPath('/v1/me/payments')");
    expect(endpoints).toContain("refunds: () => joinApiPath('/v1/me/refunds')");
    expect(api).toContain('listPayments');
    expect(api).toContain('listRefunds');
  });
});
