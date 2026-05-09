import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderWebhooksModule = typeof import('../../admin_backend/src/modules/webhooks/providerWebhooks.js');
type WebhookSecurityModule = typeof import('../../admin_backend/src/lib/webhookSecurity.js');

let providerWebhooks: ProviderWebhooksModule;
let webhookSecurity: WebhookSecurityModule;

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
    [providerWebhooks, webhookSecurity] = await Promise.all([
      import('../../admin_backend/src/modules/webhooks/providerWebhooks.js'),
      import('../../admin_backend/src/lib/webhookSecurity.js'),
    ]);
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

  it('uses idempotent Twilio event storage for replayed status callbacks', () => {
    expect(providerWebhooks.TWILIO_SMS_EVENT_UPSERT_SQL).toContain('INSERT INTO sms_events');
    expect(providerWebhooks.TWILIO_SMS_EVENT_UPSERT_SQL).toContain('ON DUPLICATE KEY UPDATE');
    expect(providerWebhooks.TWILIO_SMS_EVENT_UPSERT_SQL).toContain(
      'delivery_status_code = VALUES(delivery_status_code)',
    );
  });

  it('minimizes Resend payload snapshots instead of retaining full provider payloads', () => {
    const snapshot = providerWebhooks.buildResendEventPayloadSnapshot(
      {
        created_at: '2026-05-09T03:00:00Z',
        data: {
          email_id: 'email_unit_123',
          to: ['client@example.test'],
          // Extra provider fields can include user-visible content and should not be retained.
          subject: 'Confidential invoice subject',
        } as never,
        id: 'event_unit_123',
        type: 'email.delivered',
      },
      {
        deliveryStatus: 'delivered',
        eventType: 'email.delivered',
        providerEventId: 'event_unit_123',
        providerMessageId: 'email_unit_123',
        recipientEmail: 'client@example.test',
      },
    );

    const serialized = JSON.stringify(snapshot);
    expect(snapshot).toMatchObject({
      deliveryStatus: 'delivered',
      eventType: 'email.delivered',
      provider: 'resend',
      providerEventId: 'event_unit_123',
      providerMessageId: 'email_unit_123',
      recipientEmailMasked: 'cl***@example.test',
      retention: 'minimized_90_days',
    });
    expect(serialized).not.toContain('Confidential invoice subject');
    expect(serialized).not.toContain('client@example.test');
  });

  it('minimizes Twilio payload snapshots and masks phone numbers', () => {
    const snapshot = providerWebhooks.buildTwilioEventPayloadSnapshot(
      {
        ...twilioParams,
        Body: 'Sensitive SMS body',
        ErrorMessage: 'Carrier returned a temporary status',
      },
      {
        deliveryStatus: 'delivered',
        eventType: 'delivered',
        fromPhone: '+15551112222',
        messageSid: 'SM_unit_123',
        toPhone: '+15553334444',
      },
    );

    const serialized = JSON.stringify(snapshot);
    expect(snapshot).toMatchObject({
      deliveryStatus: 'delivered',
      eventType: 'delivered',
      fromPhoneMasked: '***2222',
      provider: 'twilio',
      providerMessageId: 'SM_unit_123',
      retention: 'minimized_90_days',
      toPhoneMasked: '***4444',
    });
    expect(serialized).not.toContain('Sensitive SMS body');
    expect(serialized).not.toContain('+15553334444');
    expect(serialized).not.toContain('+15551112222');
    expect(serialized).not.toContain('Carrier returned a temporary status');
  });

  it('allows webhook IPs only when optional allowlist matches', () => {
    expect(webhookSecurity.isWebhookIpAllowed('198.51.100.10', undefined)).toBe(true);
    expect(webhookSecurity.isWebhookIpAllowed('198.51.100.10', '')).toBe(true);
    expect(webhookSecurity.isWebhookIpAllowed('198.51.100.10', '198.51.100.10')).toBe(true);
    expect(webhookSecurity.isWebhookIpAllowed('198.51.100.10', '198.51.100.0/24')).toBe(true);
    expect(webhookSecurity.isWebhookIpAllowed('198.51.100.10', '203.0.113.0/24')).toBe(false);
  });

  it('turns abusive webhook volume into a 429 response', () => {
    expectProviderError(
      () =>
        webhookSecurity.assertWebhookRateLimitAllowed({
          allowed: false,
          retryAfterSeconds: 60,
        }),
      { code: 'webhook_rate_limited', statusCode: 429 },
    );
  });
});
