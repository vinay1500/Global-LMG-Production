import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'admin_backend/src/modules/billing/service.ts'),
  'utf8'
);

const routes = readFileSync(resolve(process.cwd(), 'admin_backend/src/routes/billing.ts'), 'utf8');

const extractBlock = (source: string, start: string, end?: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('manual payment recording integrity', () => {
  it('stores manual payments with gateway_provider_code manual and a resolved payment_method_id', () => {
    const block = extractBlock(service, 'export const recordManualPayment', 'export const createRefund');

    expect(block).toContain('const manualPaymentMethodId = await resolveManualPaymentMethodId');
    expect(block).toContain("?, ?, ?, 'manual', NULL, ?, 'captured'");
    expect(block).toContain('manualPaymentMethodId');
    expect(block).not.toContain('?, ?, NULL, ?, NULL, ?');
  });

  it('resolves cash and bank-transfer through payment_methods rows', () => {
    const block = extractBlock(service, 'const MANUAL_PAYMENT_METHOD_LABELS', 'const allocateInvoiceNumber');

    expect(block).toContain("'bank-transfer': 'Bank transfer'");
    expect(block).toContain("cash: 'Cash'");
    expect(block).toContain("provider_code = 'manual'");
    expect(block).toContain('method_type_code = ?');
    expect(block).toContain("method_status_code = 'active'");
  });

  it('rejects invalid manual payment method codes before creating a transaction', () => {
    const block = extractBlock(service, 'const normalizeManualPaymentMethodCode', 'const resolveManualPaymentMethodId');

    expect(block).toContain("throw badRequest('invalid_payment_method'");
  });
});

describe('refund creation integrity', () => {
  it('wraps refund creation in route-level idempotency', () => {
    const block = extractBlock(routes, "billingRouter.post(\n  '/billing/refunds'");

    expect(block).toContain('runIdempotentJson(request');
    expect(block).toContain("scope: 'admin:billing:refund:create'");
    expect(block).toContain('statusCode: 201');
    expect(block).toContain('Idempotency-Replayed');
  });

  it('locks the original payment before calculating refundable amount', () => {
    const block = extractBlock(service, 'export const createRefund');
    const lockIndex = block.indexOf('FOR UPDATE');
    const refundedTotalIndex = block.indexOf('const refundedTotalRows');

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(refundedTotalIndex).toBeGreaterThan(lockIndex);
    expect(block).toContain('const availableMinor = Math.max(grossMinor - refundedMinor, 0)');
    expect(block).toContain('refundAmount.minorUnits > availableMinor');
  });
});
