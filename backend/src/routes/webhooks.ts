import { Router } from 'express';
import { env } from '../config/env.js';
import { asyncHandler, badRequest } from '../lib/httpErrors.js';
import { assertWebhookRequestAllowed } from '../lib/webhookSecurity.js';
import { handleRazorpayWebhook } from '../modules/payments/razorpayService.js';

export const webhooksRouter = Router();

webhooksRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});

webhooksRouter.post(
  '/webhooks/razorpay',
  asyncHandler(async (request, response) => {
    await assertWebhookRequestAllowed(
      request,
      'razorpay',
      env.RAZORPAY_WEBHOOK_IP_ALLOWLIST
    );

    const rawBody = request.rawBody;

    if (!rawBody || rawBody.length === 0) {
      throw badRequest('missing_webhook_body', 'Webhook body is required.');
    }

    const result = await handleRazorpayWebhook({
      eventId: request.header('x-razorpay-event-id'),
      rawBody,
      signature: request.header('x-razorpay-signature'),
    });

    response.json(result);
  })
);
