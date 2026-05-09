import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { runIdempotentJson } from '../lib/idempotency.js';
import {
  createInvoice,
  createRefund,
  getWorkspace,
  recordManualPayment,
  sendInvoice,
} from '../modules/billing/service.js';
import { renderAdminInvoicePdf } from '../modules/billing/invoicePdf.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const billingRouter = Router();

const createInvoiceSchema = z.object({
  amount: z.number().positive(),
  description: z.string().trim().min(3).max(255),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  matterId: z.string().trim().min(2).max(64),
});

const createRefundSchema = z.object({
  amount: z.number().positive(),
  invoiceId: z.string().trim().min(2).max(64).optional(),
  paymentId: z.string().trim().min(2).max(64),
  reasonText: z.string().trim().min(5).max(4000),
});

const recordPaymentSchema = z.object({
  amount: z.union([z.number().positive(), z.string().trim().min(1).max(32)]),
  invoiceId: z.string().trim().min(2).max(64),
  notes: z.string().trim().max(1000).optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(['bank-transfer', 'cash', 'cheque', 'online']),
  referenceNumber: z.string().trim().max(255).optional(),
});

billingRouter.get(
  '/billing/workspace',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'invoice.view');
    response.json(
      await getWorkspace({
        limit: Number(request.query.limit || 50),
        offset: Number(request.query.offset || 0),
      })
    );
  })
);

billingRouter.get(
  '/billing/invoices/:invoiceId/download',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'invoice.view');
    const invoiceId = z.string().trim().min(2).max(64).parse(request.params.invoiceId);
    const pdf = await renderAdminInvoicePdf(invoiceId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="global-lmg-invoice-${invoiceId.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(pdf);
  })
);

billingRouter.post(
  '/billing/invoices',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'invoice.manage');
    const payload = createInvoiceSchema.parse(request.body);
    const result = await runIdempotentJson(request, {
      actorKey: actor.id,
      actorUserId: actor.userId,
      operation: () => createInvoice(actor, payload),
      scope: 'admin:billing:invoice:create',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

billingRouter.post(
  '/billing/invoices/:invoiceId/send',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'invoice.manage');
    const invoiceId = z.string().trim().min(2).max(64).parse(request.params.invoiceId);
    const result = await runIdempotentJson(request, {
      actorKey: actor.id,
      actorUserId: actor.userId,
      body: { invoiceId },
      operation: () => sendInvoice(actor, invoiceId),
      scope: 'admin:billing:invoice:send',
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

billingRouter.post(
  '/billing/payments',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'payment.manage');
    const payload = recordPaymentSchema.parse(request.body);
    const result = await runIdempotentJson(request, {
      actorKey: actor.id,
      actorUserId: actor.userId,
      operation: () => recordManualPayment(actor, payload),
      scope: 'admin:billing:payment:record',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

billingRouter.post(
  '/billing/refunds',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'refund.manage');
    const payload = createRefundSchema.parse(request.body);
    const result = await runIdempotentJson(request, {
      actorKey: actor.id,
      actorUserId: actor.userId,
      operation: () => createRefund(actor, payload),
      scope: 'admin:billing:refund:create',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);
