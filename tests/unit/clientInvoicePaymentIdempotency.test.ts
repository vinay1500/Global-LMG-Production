import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const meRoutes = readFileSync(resolve(process.cwd(), 'backend/src/routes/me.ts'), 'utf8');
const dashboardApi = readFileSync(
  resolve(process.cwd(), 'frontend/src/app/lib/api/dashboard.ts'),
  'utf8'
);

const extractBlock = (source: string, start: string, end?: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('client invoice payment verification idempotency', () => {
  it('wraps invoice payment verification in request-level idempotency', () => {
    const block = extractBlock(
      meRoutes,
      "meRouter.post(\n  '/me/invoices/:invoiceId/payment-verify'",
      "meRouter.get(\n  '/me/payments'"
    );

    expect(block).toContain('getIdempotencyKey(request)');
    expect(block).toContain("throw badRequest('idempotency_key_required'");
    expect(block).toContain('runIdempotentJson(request');
    expect(block).toContain("scope: 'client:invoice:payment:verify'");
    expect(block).toContain('invoiceId,');
    expect(block).toContain('verifyInvoicePayment({');
    expect(block).toContain('Idempotency-Replayed');
  });

  it('sends a stable idempotency key for Razorpay invoice callbacks', () => {
    const block = extractBlock(
      dashboardApi,
      'verifyInvoicePayment: (',
      'getNotificationPreferences'
    );

    expect(block).toContain('idempotency: {');
    expect(block).toContain("createIdempotencyIdentity('invoice-payment-verify'");
    expect(block).toContain('payload.razorpay_payment_id');
    expect(block).toContain('PAYMENT_IDEMPOTENCY_TTL_MS');
    expect(block).toContain('API_ENDPOINTS.me.invoicePaymentVerify(invoiceId)');
  });
});
