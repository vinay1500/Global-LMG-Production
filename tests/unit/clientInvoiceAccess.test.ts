import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const meRoutes = readFileSync(resolve(process.cwd(), 'backend/src/routes/me.ts'), 'utf8');
const dashboardRoutes = readFileSync(resolve(process.cwd(), 'backend/src/routes/dashboard.ts'), 'utf8');
const domainRepository = readFileSync(
  resolve(process.cwd(), 'backend/src/modules/domain/repository.ts'),
  'utf8'
);
const razorpayService = readFileSync(
  resolve(process.cwd(), 'backend/src/modules/payments/razorpayService.ts'),
  'utf8'
);

const extractBlock = (source: string, start: string, end?: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('client invoice/payment access checks', () => {
  it('re-checks current client-account access on client invoice and payment routes', () => {
    const invoiceList = extractBlock(meRoutes, "meRouter.get(\n  '/me/invoices'", "meRouter.get(\n  '/me/invoices/:invoiceId'");
    const invoiceDetail = extractBlock(
      meRoutes,
      "meRouter.get(\n  '/me/invoices/:invoiceId'",
      "meRouter.get(\n  '/me/invoices/:invoiceId/download'"
    );
    const invoiceDownload = extractBlock(
      meRoutes,
      "meRouter.get(\n  '/me/invoices/:invoiceId/download'",
      "meRouter.post(\n  '/me/invoices/:invoiceId/payment-order'"
    );
    const paymentOrder = extractBlock(
      meRoutes,
      "meRouter.post(\n  '/me/invoices/:invoiceId/payment-order'",
      "meRouter.post(\n  '/me/invoices/:invoiceId/payment-verify'"
    );
    const paymentVerify = extractBlock(
      meRoutes,
      "meRouter.post(\n  '/me/invoices/:invoiceId/payment-verify'",
      "meRouter.get(\n  '/me/payments'"
    );
    const paymentsList = extractBlock(meRoutes, "meRouter.get(\n  '/me/payments'", "meRouter.get(\n  '/me/refunds'");
    const refundsList = extractBlock(meRoutes, "meRouter.get(\n  '/me/refunds'");

    for (const block of [
      invoiceList,
      invoiceDetail,
      invoiceDownload,
      paymentOrder,
      paymentVerify,
      paymentsList,
      refundsList,
    ]) {
      expect(block).toContain('domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!)');
    }
  });

  it('passes actor public id into invoice and request payment operations', () => {
    const invoicePaymentOrder = extractBlock(
      meRoutes,
      'createInvoicePaymentOrder({',
      'invoicePublicId: invoiceId,'
    );
    const invoicePaymentVerify = extractBlock(
      meRoutes,
      'verifyInvoicePayment({',
      'razorpaySignature: payload.razorpay_signature,'
    );
    const requestPaymentOrder = extractBlock(
      dashboardRoutes,
      'createServiceRequestPaymentOrder({',
      'requestPublicId: draft.requestId,'
    );
    const requestPaymentVerify = extractBlock(
      dashboardRoutes,
      'verifyServiceRequestPayment({',
      'razorpaySignature: payload.razorpay_signature,'
    );

    expect(invoicePaymentOrder).toContain('actorUserPublicId: actor.publicId');
    expect(invoicePaymentVerify).toContain('actorUserPublicId: actor.publicId');
    expect(requestPaymentOrder).toContain('actorUserPublicId: dashboardUser.id');
    expect(requestPaymentVerify).toContain('actorUserPublicId: authenticatedUser.id');
  });

  it('requires active role, portal contact, and active client account in DB access checks', () => {
    for (const source of [domainRepository, razorpayService]) {
      expect(source).toContain("ur.role_code = 'client'");
      expect(source).toContain('ur.is_active = 1');
      expect(source).toContain('cac.portal_access_enabled = 1');
      expect(source).toContain('cac.archived_at IS NULL');
      expect(source).toContain('ca.archived_at IS NULL');
      expect(source).toContain('u.actor_type_code = \'client\'');
      expect(source).toContain('u.login_enabled = 1');
      expect(source).toContain('u.archived_at IS NULL');
    }
  });

  it('re-resolves actor access inside Razorpay payment order and verification flows', () => {
    const invoiceOrder = extractBlock(
      razorpayService,
      'export const createInvoicePaymentOrder',
      'const getServiceRequestForPayment'
    );
    const requestOrder = extractBlock(
      razorpayService,
      'export const createServiceRequestPaymentOrder',
      'const getExistingPayment'
    );
    const invoiceVerify = extractBlock(
      razorpayService,
      'export const verifyInvoicePayment',
      'export const verifyServiceRequestPayment'
    );
    const requestVerify = extractBlock(
      razorpayService,
      'export const verifyServiceRequestPayment',
      'const parseWebhookPayload'
    );

    for (const block of [invoiceOrder, requestOrder, invoiceVerify, requestVerify]) {
      expect(block).toContain('assertClientPaymentActorAccess(connection');
    }

    expect(invoiceOrder).toContain('getInvoiceForPayment(connection, input.clientAccountId, input.invoicePublicId)');
    expect(invoiceVerify).toContain('gatewayOrder.client_account_id !== input.clientAccountId');
    expect(invoiceVerify).toContain('AND archived_at IS NULL');
  });
});
