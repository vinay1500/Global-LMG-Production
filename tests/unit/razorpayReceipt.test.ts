import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOpaqueRazorpayReceipt } from '../../backend/src/modules/payments/razorpayService.js';

describe('Razorpay order receipts', () => {
  it('creates an opaque receipt that does not include invoice or request public IDs', () => {
    const invoicePublicId = 'inv_public_1234567890';
    const requestPublicId = 'req_public_1234567890';
    const receipt = createOpaqueRazorpayReceipt('01HXOPAQUEPAYMENTORDER000001');

    expect(receipt).toBe('glmg_01hxopaquepaymentorder000001');
    expect(receipt.length).toBeLessThanOrEqual(40);
    expect(receipt).not.toContain(invoicePublicId);
    expect(receipt).not.toContain(requestPublicId);
    expect(receipt).not.toContain('inv_');
    expect(receipt).not.toContain('req_');
  });

  it('generates unique opaque receipts by default', () => {
    const firstReceipt = createOpaqueRazorpayReceipt();
    const secondReceipt = createOpaqueRazorpayReceipt();

    expect(firstReceipt).toMatch(/^glmg_[a-z0-9]+$/);
    expect(secondReceipt).toMatch(/^glmg_[a-z0-9]+$/);
    expect(firstReceipt).not.toBe(secondReceipt);
  });

  it('keeps internal payment gateway order mappings for reconciliation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'backend/src/modules/payments/razorpayService.ts'),
      'utf8'
    );

    expect(source).toContain('INSERT INTO payment_gateway_orders');
    expect(source).toContain('provider_order_id');
    expect(source).toContain('invoice_id');
    expect(source).toContain('service_request_id');
    expect(source).toContain('receipt');
  });
});
