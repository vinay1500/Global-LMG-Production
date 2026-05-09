import { type Request, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireActor, assertPermission } from '../lib/authorization.js';
import { requireAuthenticatedUser } from '../lib/authSession.js';
import { hashOpaqueValue } from '../lib/authCrypto.js';
import { requireCsrf } from '../lib/csrf.js';
import { badRequest, forbidden, tooManyRequests } from '../lib/httpErrors.js';
import { asyncHandler } from '../lib/httpErrors.js';
import { getIdempotencyKey, runIdempotentJson } from '../lib/idempotency.js';
import { renderInvoicePdf } from '../lib/invoicePdf.js';
import { getRequestIpAddress } from '../lib/requestSecurity.js';
import { clientAccountsService } from '../modules/clientAccounts/service.js';
import { consumePersistentRateLimit } from '../modules/auth/persistentRateLimiter.js';
import { domainService } from '../modules/domain/service.js';
import {
  createInvoicePaymentOrder,
  verifyInvoicePayment,
} from '../modules/payments/razorpayService.js';
import { documentStorageService } from '../modules/storage/service.js';

export const meRouter = Router();

const notificationPreferencesSchema = z.object({
  caseActivityAlerts: z.boolean(),
  emailUpdates: z.boolean(),
  inAppAlerts: z.boolean().default(true),
  invoiceReminders: z.boolean(),
  productAnnouncements: z.boolean(),
  smsAlerts: z.boolean(),
});

const accountAddressSchema = z.object({
  line1: z.string().trim().min(3).max(255),
  line2: z.string().trim().max(255).optional().default(''),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(20),
  country: z.string().trim().min(2).max(80),
  sourceCode: z.enum(['google', 'ip_prefill', 'manual']).default('manual'),
  googlePlaceId: z.string().trim().max(255).optional().nullable(),
  validationStatusCode: z.enum(['manual', 'unverified', 'verified']).default('manual'),
});

const accountNameSchema = z.object({
  name: z.string().trim().min(2).max(160),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

const emailChangeRequestSchema = z.object({
  email: z.string().trim().email(),
});

export const emailChangeConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
  email: z.string().trim().email(),
});

const phoneChangeRequestSchema = z.object({
  phone: z.string().trim().min(8).max(40),
});

export const phoneChangeConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit verification code.'),
  phone: z.string().trim().min(8).max(40),
});

const invoicePaymentOrderSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional().nullable(),
});

const invoicePaymentVerifySchema = z.object({
  razorpay_order_id: z.string().trim().min(6).max(120),
  razorpay_payment_id: z.string().trim().min(6).max(120),
  razorpay_signature: z.string().trim().min(32).max(256),
});

const requireClientActor = async (request: Parameters<typeof requireActor>[0], response: Parameters<typeof requireActor>[1]) => {
  const actor = await requireActor(request, response);

  if (!actor.clientAccountId) {
    throw forbidden('client_account_required', 'A linked client account is required.');
  }

  return actor;
};

const getRouteParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || '' : value || '';

const sanitizeDownloadFilename = (value: string) =>
  value.replace(/["\r\n]+/g, '_').trim() || 'download.bin';

const getUserAgent = (request: Request) => request.get('user-agent') || null;

const hashRateLimitIdentifier = (value: string) =>
  hashOpaqueValue(value.trim().toLowerCase(), env.AUTH_SESSION_SECRET);

const consumeAccountCodeRateLimit = async (
  actionCode:
    | 'email-change-confirm'
    | 'email-change-request'
    | 'phone-change-confirm'
    | 'phone-change-request',
  request: Request,
  userPublicId: string,
  identifier?: string
) => {
  const keys = [
    {
      key: `${actionCode}:ip:${getRequestIpAddress(request)}`,
      maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
    },
    {
      key: `${actionCode}:user:${userPublicId}`,
      maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    },
  ];

  if (identifier?.trim()) {
    keys.push({
      key: `${actionCode}:user-identifier:${userPublicId}:${hashRateLimitIdentifier(identifier)}`,
      maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    });
  }

  for (const key of keys) {
    const rateLimit = await consumePersistentRateLimit({
      key: key.key,
      maxAttempts: key.maxAttempts,
      scope: 'client_account_codes',
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    });

    if (!rateLimit.allowed) {
      throw tooManyRequests(
        'too_many_attempts',
        'Too many attempts. Please wait before trying again.',
        rateLimit.retryAfterSeconds
      );
    }
  }
};

meRouter.get(
  '/me/preferences',
  asyncHandler(async (request, response) => {
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const preferences = await clientAccountsService.getNotificationPreferences(
      authenticatedUser.id
    );
    response.json(preferences);
  })
);

meRouter.put(
  '/me/preferences',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const preferences = notificationPreferencesSchema.parse(request.body);
    const nextPreferences = await clientAccountsService.updateNotificationPreferences(
      authenticatedUser.id,
      preferences
    );
    response.json(nextPreferences);
  })
);

meRouter.get(
  '/me/account-settings',
  asyncHandler(async (request, response) => {
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    response.json(await clientAccountsService.getAccountSettings(authenticatedUser.id));
  })
);

meRouter.patch(
  '/me/account/address',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    response.json(
      await clientAccountsService.updatePrimaryAddress(
        authenticatedUser.id,
        accountAddressSchema.parse(request.body)
      )
    );
  })
);

meRouter.patch(
  '/me/account/name',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    response.json(
      await clientAccountsService.updateDisplayName(
        authenticatedUser.id,
        accountNameSchema.parse(request.body)
      )
    );
  })
);

meRouter.post(
  '/me/account/password',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    response.json(
      await clientAccountsService.changePassword(
        authenticatedUser.id,
        changePasswordSchema.parse(request.body)
      )
    );
  })
);

meRouter.post(
  '/me/account/email-change/request',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = emailChangeRequestSchema.parse(request.body);
    await consumeAccountCodeRateLimit(
      'email-change-request',
      request,
      authenticatedUser.id,
      payload.email
    );
    response.json(await clientAccountsService.requestEmailChange(authenticatedUser.id, payload.email));
  })
);

meRouter.post(
  '/me/account/email-change/confirm',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = emailChangeConfirmSchema.parse(request.body);
    await consumeAccountCodeRateLimit(
      'email-change-confirm',
      request,
      authenticatedUser.id,
      payload.email
    );
    response.json(
      await clientAccountsService.confirmEmailChange(
        authenticatedUser.id,
        payload
      )
    );
  })
);

meRouter.post(
  '/me/account/phone-change/request',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = phoneChangeRequestSchema.parse(request.body);
    await consumeAccountCodeRateLimit(
      'phone-change-request',
      request,
      authenticatedUser.id,
      payload.phone
    );
    response.json(await clientAccountsService.requestPhoneChange(authenticatedUser.id, payload.phone));
  })
);

meRouter.post(
  '/me/account/phone-change/confirm',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = phoneChangeConfirmSchema.parse(request.body);
    await consumeAccountCodeRateLimit(
      'phone-change-confirm',
      request,
      authenticatedUser.id,
      payload.phone
    );
    response.json(
      await clientAccountsService.confirmPhoneChange(
        authenticatedUser.id,
        payload
      )
    );
  })
);

meRouter.get(
  '/me/client-account',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'client_account.view');
    const clientAccount = await domainService.getMyClientAccount(actor.publicId);
    response.json(clientAccount);
  })
);

meRouter.get(
  '/me/matters',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'matter.view');
    const matters = await domainService.listClientMatters(actor.clientAccountId!);
    response.json(matters);
  })
);

meRouter.get(
  '/me/matters/:matterId',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'matter.view');
    const matter = await domainService.getClientMatter(actor.clientAccountId!, getRouteParam(request.params.matterId));
    response.json(matter);
  })
);

meRouter.get(
  '/me/documents',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'document.view');
    const documents = await domainService.listClientDocuments(actor.clientAccountId!);
    response.json(documents);
  })
);

meRouter.get(
  '/me/documents/:documentId',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'document.view');
    const document = await domainService.getClientDocument(
      actor.clientAccountId!,
      getRouteParam(request.params.documentId)
    );
    response.json(document);
  })
);

meRouter.get(
  '/me/documents/:documentId/download',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'document.download');
    const result = await documentStorageService.getClientDocumentDownload(
      actor.publicId,
      actor.clientAccountId!,
      getRouteParam(request.params.documentId),
      {
        ipAddress: request.ip,
        userAgent: getUserAgent(request),
      }
    );

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeDownloadFilename(result.originalName)}"`);
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(result.content);
  })
);

meRouter.get(
  '/me/documents/:documentId/preview',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'document.view');
    const result = await documentStorageService.getClientDocumentPreview(
      actor.publicId,
      actor.clientAccountId!,
      getRouteParam(request.params.documentId),
      {
        ipAddress: request.ip,
        userAgent: getUserAgent(request),
      }
    );

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `inline; filename="${sanitizeDownloadFilename(result.originalName)}"`);
    response.setHeader('Content-Security-Policy', 'sandbox');
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(result.content);
  })
);

meRouter.get(
  '/me/events',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'event.view');
    const events = await domainService.listClientEvents(actor.clientAccountId!);
    response.json(events);
  })
);

meRouter.get(
  '/me/invoices',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'invoice.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const invoices = await domainService.listClientInvoices(actor.clientAccountId!);
    response.json(invoices);
  })
);

meRouter.get(
  '/me/invoices/:invoiceId',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'invoice.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const invoice = await domainService.getClientInvoice(
      actor.clientAccountId!,
      getRouteParam(request.params.invoiceId)
    );
    response.json(invoice);
  })
);

meRouter.get(
  '/me/invoices/:invoiceId/download',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'invoice.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const invoice = await domainService.getClientInvoice(
      actor.clientAccountId!,
      getRouteParam(request.params.invoiceId)
    );
    const pdf = await renderInvoicePdf(invoice);
    const filename = sanitizeDownloadFilename(`${invoice.invoiceNumber || invoice.id}.pdf`);

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(pdf);
  })
);

meRouter.post(
  '/me/invoices/:invoiceId/payment-order',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'invoice.view');
    assertPermission(actor.permissionCodes, 'payment.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const idempotencyKey = getIdempotencyKey(request);
    if (!idempotencyKey) {
      throw badRequest('idempotency_key_required', 'Idempotency-Key is required to create a payment order.');
    }
    const payload = invoicePaymentOrderSchema.parse(request.body);
    const invoiceId = getRouteParam(request.params.invoiceId);
    const result = await runIdempotentJson(request, {
      actorKey: actor.publicId,
      actorUserId: actor.userId,
      body: payload,
      operation: () =>
        createInvoicePaymentOrder({
          actorUserId: actor.userId,
          actorUserPublicId: actor.publicId,
          amount: payload.amount,
          clientAccountId: actor.clientAccountId!,
          idempotencyKey,
          invoicePublicId: invoiceId,
        }),
      scope: 'client.invoice.payment_order',
    });

    response.status(result.statusCode).json(result.body);
  })
);

meRouter.post(
  '/me/invoices/:invoiceId/payment-verify',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'invoice.view');
    assertPermission(actor.permissionCodes, 'payment.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const idempotencyKey = getIdempotencyKey(request);
    if (!idempotencyKey) {
      throw badRequest('idempotency_key_required', 'Idempotency-Key is required to verify a payment.');
    }
    const payload = invoicePaymentVerifySchema.parse(request.body);
    const invoiceId = getRouteParam(request.params.invoiceId);
    const result = await runIdempotentJson(request, {
      actorKey: actor.publicId,
      actorUserId: actor.userId,
      body: {
        invoiceId,
        ...payload,
      },
      operation: () =>
        verifyInvoicePayment({
          actorUserId: actor.userId,
          actorUserPublicId: actor.publicId,
          clientAccountId: actor.clientAccountId!,
          invoicePublicId: invoiceId,
          razorpayOrderId: payload.razorpay_order_id,
          razorpayPaymentId: payload.razorpay_payment_id,
          razorpaySignature: payload.razorpay_signature,
        }),
      scope: 'client:invoice:payment:verify',
    });

    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

meRouter.get(
  '/me/payments',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'payment.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const payments = await domainService.listClientPayments(actor.clientAccountId!);
    response.json(payments);
  })
);

meRouter.get(
  '/me/refunds',
  asyncHandler(async (request, response) => {
    const actor = await requireClientActor(request, response);
    assertPermission(actor.permissionCodes, 'refund.view');
    await domainService.assertCurrentClientAccountAccess(actor.publicId, actor.clientAccountId!);
    const refunds = await domainService.listClientRefunds(actor.clientAccountId!);
    response.json(refunds);
  })
);
