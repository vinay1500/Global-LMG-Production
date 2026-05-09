import { createHash } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { requireAuthenticatedUser } from '../lib/authSession.js';
import { requireCsrf } from '../lib/csrf.js';
import { asyncHandler } from '../lib/httpErrors.js';
import { requireIdempotencyKey, runIdempotentJson } from '../lib/idempotency.js';
import { isMessageContentWithinLimit, sanitizeMessageContent } from '../lib/messageContent.js';
import { dashboardService } from '../modules/dashboard/service.js';
import type { PlatformUser } from '../modules/dashboard/types.js';
import {
  assertRazorpayPaymentProviderReady,
  createServiceRequestPaymentOrder,
  verifyServiceRequestPayment,
} from '../modules/payments/razorpayService.js';

export const dashboardRouter = Router();

const requestDocumentSchema = z.object({
  name: z.string().trim().min(1).max(240),
  size: z.coerce.number().int().nonnegative(),
  type: z.string().trim().min(1).max(120),
});

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_TIME_WINDOW_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/;
const REQUEST_TIME_WINDOW_DURATION_MINUTES = 45;
const REQUEST_TIME_WINDOW_INTERVAL_MINUTES = 30;
const DASHBOARD_MESSAGE_CONTENT_MAX_LENGTH = 5000;

const isIsoCalendarDate = (value: string) => {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const clockMinutes = (value: string) => {
  const [hourRaw, minuteRaw] = value.split(':').map((part) => Number(part));
  return hourRaw * 60 + minuteRaw;
};

export const isDashboardRequestTimeWindow = (value: string) => {
  if (!REQUEST_TIME_WINDOW_PATTERN.test(value)) {
    return false;
  }

  const [startClock, endClock] = value.split('-');
  const startMinutes = clockMinutes(startClock);
  const endMinutes = clockMinutes(endClock);
  const durationMinutes = (endMinutes - startMinutes + 1440) % 1440;

  return (
    startMinutes % REQUEST_TIME_WINDOW_INTERVAL_MINUTES === 0 &&
    durationMinutes === REQUEST_TIME_WINDOW_DURATION_MINUTES
  );
};

export const dashboardRequestSchema = z.object({
  services: z.array(z.string().trim().min(1)).min(1),
  legalDomain: z.string().trim().min(2).max(80),
  caseDetails: z.string().trim().min(10).max(5000),
  documentUploadIds: z.array(z.string().trim().min(1).max(96)).max(12).default([]),
  documents: z.array(requestDocumentSchema).max(12),
  consultationMode: z.string().trim().min(1).max(32),
  preferredDate: z
    .string()
    .trim()
    .regex(ISO_DATE_PATTERN, 'Choose a valid preferred date.')
    .refine(isIsoCalendarDate, 'Choose a valid preferred date.'),
  preferredEndAtUtc: z.string().datetime().optional(),
  preferredStartAtUtc: z.string().datetime().optional(),
  preferredTime: z
    .string()
    .trim()
    .regex(REQUEST_TIME_WINDOW_PATTERN, 'Choose a valid preferred time window.')
    .refine(isDashboardRequestTimeWindow, 'Choose a valid preferred time window.'),
  preferredTimezone: z
    .string()
    .trim()
    .regex(/^(UTC|[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/, 'Choose a valid time zone.')
    .max(80)
    .optional(),
  urgency: z.string().trim().min(1).max(32),
  pastLegalAction: z.boolean(),
}).superRefine((value, context) => {
  const startTime = value.preferredStartAtUtc ? Date.parse(value.preferredStartAtUtc) : undefined;
  const endTime = value.preferredEndAtUtc ? Date.parse(value.preferredEndAtUtc) : undefined;

  if (
    startTime !== undefined &&
    endTime !== undefined &&
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    endTime <= startTime
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Choose a valid preferred time window.',
      path: ['preferredEndAtUtc'],
    });
  }
});

const dashboardMessageSchema = z.object({
  attachmentUploadIds: z.array(z.string().trim().min(1).max(96)).max(8).default([]),
  threadId: z.string().trim().min(1),
  content: z
    .string()
    .default('')
    .refine(
      (value) => isMessageContentWithinLimit(value, DASHBOARD_MESSAGE_CONTENT_MAX_LENGTH),
      'Message content must be 5,000 characters or fewer.'
    )
    .transform(sanitizeMessageContent),
}).refine(
  (value) => value.content.length > 0 || value.attachmentUploadIds.length > 0,
  {
    message: 'A message must include text or at least one attachment.',
    path: ['content'],
  }
);

const dashboardPackageSelectionSchema = z.object({
  matterPackageId: z.string().trim().min(1).max(64),
  proposalVersion: z.coerce.number().int().positive(),
});

const requestPaymentVerifySchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(120),
  razorpay_payment_id: z.string().trim().min(1).max(120),
  razorpay_signature: z.string().trim().min(1).max(160),
});

const toDashboardUser = (user: Awaited<ReturnType<typeof requireAuthenticatedUser>>) =>
  ({
    avatar: user.avatar,
    email: user.email,
    id: user.id,
    joinedAt: user.joinedAt,
    lastActiveAt: user.lastActiveAt,
    lifecycle: user.lifecycle as PlatformUser['lifecycle'],
    name: user.name,
    owner: user.owner,
    phone: user.phone,
    region: user.region,
  }) satisfies PlatformUser;

const respondWithSnapshot = (response: Response, snapshot: Awaited<ReturnType<typeof dashboardService.getSnapshot>>) => {
  response.json(snapshot);
};

const respondWithCacheableSnapshot = (
  request: Request,
  response: Response,
  snapshot: Awaited<ReturnType<typeof dashboardService.getSnapshot>>
) => {
  const serialized = JSON.stringify(snapshot);
  const etag = `W/"${createHash('sha256').update(serialized).digest('base64url')}"`;

  response.setHeader('Cache-Control', 'private, no-cache');
  response.setHeader('ETag', etag);

  if (request.header('if-none-match') === etag) {
    response.status(304).end();
    return;
  }

  response.type('application/json').send(serialized);
};

dashboardRouter.get(
  '/dashboard',
  asyncHandler(async (request, response) => {
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const snapshot = await dashboardService.getSnapshot(toDashboardUser(authenticatedUser));
    respondWithCacheableSnapshot(request, response, snapshot);
  })
);

dashboardRouter.get(
  '/dashboard/request-config',
  asyncHandler(async (request, response) => {
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    response.json(await dashboardService.getRequestPricingConfig(toDashboardUser(authenticatedUser)));
  })
);

dashboardRouter.post(
  '/dashboard/requests',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = dashboardRequestSchema.parse(request.body);
    const dashboardUser = toDashboardUser(authenticatedUser);
    const idempotencyKey = requireIdempotencyKey(
      request,
      'Idempotency-Key header is required to submit a request.'
    );
    const result = await runIdempotentJson(request, {
      actorKey: dashboardUser.id,
      operation: async () => {
        assertRazorpayPaymentProviderReady();
        const draft = await dashboardService.submitRequest(dashboardUser, payload);
        const paymentOrder = await createServiceRequestPaymentOrder({
          actorUserId: draft.actorUserId,
          actorUserPublicId: dashboardUser.id,
          clientAccountId: draft.clientAccountId,
          idempotencyKey,
          requestPublicId: draft.requestId,
        });

        return {
          paymentOrder,
          requestId: draft.requestId,
        };
      },
      scope: 'client:dashboard:request:submit',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

dashboardRouter.post(
  '/dashboard/requests/:requestId/payment-verify',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = requestPaymentVerifySchema.parse(request.body);
    const requestId = z.string().trim().min(1).max(64).parse(request.params.requestId);

    response.json(
      await verifyServiceRequestPayment({
        actorUserPublicId: authenticatedUser.id,
        requestPublicId: requestId,
        razorpayOrderId: payload.razorpay_order_id,
        razorpayPaymentId: payload.razorpay_payment_id,
        razorpaySignature: payload.razorpay_signature,
      })
    );
  })
);

dashboardRouter.post(
  '/dashboard/messages',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = dashboardMessageSchema.parse(request.body);
    const snapshot = await dashboardService.sendMessage(
      toDashboardUser(authenticatedUser),
      payload.threadId,
      payload.content,
      payload.attachmentUploadIds
    );
    respondWithSnapshot(response, snapshot);
  })
);

dashboardRouter.post(
  '/dashboard/messages/:threadId/read',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const threadId = z.string().trim().min(1).max(96).parse(request.params.threadId);
    const snapshot = await dashboardService.markThreadRead(
      toDashboardUser(authenticatedUser),
      threadId
    );
    respondWithSnapshot(response, snapshot);
  })
);

dashboardRouter.post(
  '/dashboard/matters/:matterId/package-selection',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const matterId = z.string().trim().min(1).max(64).parse(request.params.matterId);
    const payload = dashboardPackageSelectionSchema.parse(request.body);
    response.json(
      await dashboardService.selectMatterPackage(
        toDashboardUser(authenticatedUser),
        matterId,
        payload.matterPackageId,
        payload.proposalVersion
      )
    );
  })
);
