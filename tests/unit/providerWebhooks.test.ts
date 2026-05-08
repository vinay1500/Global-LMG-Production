import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderWebhooksModule = typeof import('../../admin_backend/src/modules/webhooks/providerWebhooks.js');

let providerWebhooks: ProviderWebhooksModule;

const fixedNowSeconds = 1_779_000_000;

const resendSecretValue = 'resend-unit-test-secret';
const resendSecret = `whsec_${Buffer.from(resendSecretValue).toString('base64')}`;
const resendId = 'msg_unit_test';
const resendPayload = Buffer.from(
  JSON.stringify({
    data: {
      email_id: 'email_unit_123',
      to: ['client@example.test'],
    },
    id: 'event_unit_123',
    type: 'email.delivered',
  }),
);

const twilioAuthToken = 'twilio-unit-test-token';
const twilioUrl = 'https://api.globallmg.test/api/v1/webhooks/twilio/status';
const twilioParams = {
  From: '+15551112222',
  MessageSid: 'SM_unit_123',
  MessageStatus: 'delivered',
  To: '+15553334444',
};

const buildResendSignature = (
  payload: Buffer,
  timestamp: string,
  id = resendId,
  secretValue = resendSecretValue,
) => {
  const signedPayload = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, 'utf8'), payload]);
  const signature = createHmac('sha256', Buffer.from(secretValue))
    .update(signedPayload)
    .digest('base64');

  return `v1,${signature}`;
};

const expectProviderError = (
  callback: () => unknown,
  expected: { code: string; statusCode: number },
) => {
  expect(callback).toThrow(
    expect.objectContaining({
      code: expected.code,
      statusCode: expected.statusCode,
    }),
  );
};

describe('provider webhook signature verification', () => {
  beforeAll(async () => {
    process.env.AUTH_SESSION_SECRET =
      'unit-test-admin-session-secret-with-more-than-thirty-two-chars';
    providerWebhooks = await import('../../admin_backend/src/modules/webhooks/providerWebhooks.js');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixedNowSeconds * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a valid Resend Svix signature', () => {
    const timestamp = String(fixedNowSeconds);
    const signature = buildResendSignature(resendPayload, timestamp);

    expect(
      providerWebhooks.verifyResendWebhookSignature({
        id: resendId,
        payload: resendPayload,
        secret: resendSecret,
        signature,
        timestamp,
      }),
    ).toBe(true);
  });

  it('rejects a tampered Resend payload', () => {
    const timestamp = String(fixedNowSeconds);
    const signature = buildResendSignature(resendPayload, timestamp);
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        data: {
          email_id: 'email_unit_123',
          to: ['attacker@example.test'],
        },
        id: 'event_unit_123',
        type: 'email.delivered',
      }),
    );

    expectProviderError(
      () =>
        providerWebhooks.verifyResendWebhookSignature({
          id: resendId,
          payload: tamperedPayload,
          secret: resendSecret,
          signature,
          timestamp,
        }),
      { code: 'invalid_resend_signature', statusCode: 401 },
    );
  });

  it('rejects a Resend timestamp older than five minutes', () => {
    const timestamp = String(fixedNowSeconds - 301);
    const signature = buildResendSignature(resendPayload, timestamp);

    expectProviderError(
      () =>
        providerWebhooks.verifyResendWebhookSignature({
          id: resendId,
          payload: resendPayload,
          secret: resendSecret,
          signature,
          timestamp,
        }),
      { code: 'invalid_resend_signature', statusCode: 401 },
    );
  });

  it('accepts a valid Twilio HMAC SHA-1 signature', () => {
    const signature = providerWebhooks.buildTwilioSignature(twilioUrl, twilioParams, twilioAuthToken);

    expect(
      providerWebhooks.verifyTwilioWebhookSignature({
        authToken: twilioAuthToken,
        params: twilioParams,
        signature,
        url: twilioUrl,
      }),
    ).toBe(true);
  });

  it('rejects a tampered Twilio payload', () => {
    const signature = providerWebhooks.buildTwilioSignature(twilioUrl, twilioParams, twilioAuthToken);

    expectProviderError(
      () =>
        providerWebhooks.verifyTwilioWebhookSignature({
          authToken: twilioAuthToken,
          params: {
            ...twilioParams,
            MessageStatus: 'failed',
          },
          signature,
          url: twilioUrl,
        }),
      { code: 'invalid_twilio_signature', statusCode: 401 },
    );
  });

  it('rejects missing webhook secrets as forbidden', () => {
    const timestamp = String(fixedNowSeconds);
    const resendSignature = buildResendSignature(resendPayload, timestamp);
    const twilioSignature = providerWebhooks.buildTwilioSignature(
      twilioUrl,
      twilioParams,
      twilioAuthToken,
    );

    expectProviderError(
      () =>
        providerWebhooks.verifyResendWebhookSignature({
          id: resendId,
          payload: resendPayload,
          secret: undefined,
          signature: resendSignature,
          timestamp,
        }),
      { code: 'resend_webhook_secret_missing', statusCode: 403 },
    );

    expectProviderError(
      () =>
        providerWebhooks.verifyTwilioWebhookSignature({
          authToken: undefined,
          params: twilioParams,
          signature: twilioSignature,
          url: twilioUrl,
        }),
      { code: 'twilio_webhook_secret_missing', statusCode: 403 },
    );
  });
});
