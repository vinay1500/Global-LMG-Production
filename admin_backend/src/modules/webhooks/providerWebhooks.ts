import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env.js';
import { createPublicId } from '../../lib/authCrypto.js';
import { forbidden, unauthorized } from '../../lib/httpErrors.js';
import { executeStatement } from '../../lib/mysql.js';

type ResendWebhookPayload = {
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
  };
  id?: string;
  type?: string;
};

type TwilioStatusPayload = Record<string, string | string[] | undefined>;

const RESEND_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const truncate = (value: string | null | undefined, maxLength = 255) => {
  if (!value) {
    return null;
  }

  return value.length > maxLength ? value.slice(0, maxLength) : value;
};

const safeJson = (value: unknown) => JSON.stringify(value ?? {});

const getFirst = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || '' : value || '';

const maskEmail = (value: string | null | undefined) => {
  if (!value || !value.includes('@')) {
    return null;
  }

  const [localPart = '', domain = ''] = value.split('@');
  const visibleLocal = localPart.slice(0, 2);
  return `${visibleLocal}${localPart.length > 2 ? '***' : '*'}@${domain}`;
};

const maskPhone = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '****';
  }

  return `***${digits.slice(-4)}`;
};

const constantTimeEquals = (left: Buffer, right: Buffer) =>
  left.length === right.length && timingSafeEqual(left, right);

const decodeSvixSecret = (secret: string) => {
  const rawSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(rawSecret, 'base64');
};

const parseSvixSignatures = (signatureHeader: string) =>
  signatureHeader
    .split(' ')
    .map((part) => part.trim())
    .map((part) =>
      part.startsWith('v1,')
        ? part.slice('v1,'.length)
        : part.startsWith('v1=')
          ? part.slice('v1='.length)
          : ''
    )
    .filter(Boolean);

export const verifyResendWebhookSignature = (input: {
  id: string | undefined;
  payload: Buffer;
  secret: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
}) => {
  if (!input.secret) {
    throw forbidden('resend_webhook_secret_missing', 'Resend webhook secret is not configured.');
  }

  if (!input.id || !input.timestamp || !input.signature) {
    throw unauthorized('invalid_resend_signature', 'Invalid Resend webhook signature.');
  }

  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw unauthorized('invalid_resend_signature', 'Invalid Resend webhook signature.');
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > RESEND_WEBHOOK_TOLERANCE_SECONDS) {
    throw unauthorized('invalid_resend_signature', 'Invalid Resend webhook signature.');
  }

  const signedPayload = Buffer.concat([
    Buffer.from(`${input.id}.${input.timestamp}.`, 'utf8'),
    input.payload,
  ]);
  const expected = createHmac('sha256', decodeSvixSecret(input.secret))
    .update(signedPayload)
    .digest();

  for (const signature of parseSvixSignatures(input.signature)) {
    const actual = Buffer.from(signature, 'base64');
    if (constantTimeEquals(expected, actual)) {
      return true;
    }
  }

  throw unauthorized('invalid_resend_signature', 'Invalid Resend webhook signature.');
};

const getTwilioWebhookUrl = (request: Request) => {
  const baseUrl =
    env.WEBHOOK_PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
    `${request.protocol}://${request.get('host')}`;
  return `${baseUrl}${request.originalUrl}`;
};

export const buildTwilioSignature = (
  url: string,
  params: Record<string, string>,
  authToken: string
) => {
  const signedValue = Object.keys(params)
    .sort()
    .reduce((current, key) => `${current}${key}${params[key] ?? ''}`, url);

  return createHmac('sha1', authToken).update(signedValue).digest('base64');
};

export const verifyTwilioWebhookSignature = (input: {
  authToken: string | undefined;
  params: Record<string, string>;
  signature: string | undefined;
  url: string;
}) => {
  if (!input.authToken) {
    throw forbidden('twilio_webhook_secret_missing', 'Twilio webhook auth token is not configured.');
  }

  if (!input.signature) {
    throw unauthorized('invalid_twilio_signature', 'Invalid Twilio webhook signature.');
  }

  const expected = Buffer.from(buildTwilioSignature(input.url, input.params, input.authToken));
  const actual = Buffer.from(input.signature);

  if (!constantTimeEquals(expected, actual)) {
    throw unauthorized('invalid_twilio_signature', 'Invalid Twilio webhook signature.');
  }

  return true;
};

const mapResendStatus = (type: string) => {
  const normalized = type.toLowerCase();

  if (normalized.includes('delivered')) {
    return 'delivered';
  }

  if (normalized.includes('bounced')) {
    return 'bounced';
  }

  if (normalized.includes('complained') || normalized.includes('complaint')) {
    return 'complained';
  }

  if (normalized.includes('failed')) {
    return 'failed';
  }

  if (normalized.includes('sent')) {
    return 'sent';
  }

  return normalized.replace(/[^a-z0-9_]+/g, '_').slice(0, 40) || 'received';
};

const mapTwilioStatus = (status: string) => {
  const normalized = status.toLowerCase();

  if (['delivered'].includes(normalized)) {
    return 'delivered';
  }

  if (['undelivered', 'failed'].includes(normalized)) {
    return 'failed';
  }

  if (['sent', 'queued', 'sending', 'accepted'].includes(normalized)) {
    return normalized;
  }

  return normalized.replace(/[^a-z0-9_]+/g, '_').slice(0, 40) || 'received';
};

const extractResendRecipient = (payload: ResendWebhookPayload) => {
  const to = payload.data?.to;

  if (Array.isArray(to)) {
    return to[0] || null;
  }

  return to || null;
};

export const buildResendEventPayloadSnapshot = (
  payload: ResendWebhookPayload,
  derived: {
    deliveryStatus: string;
    eventType: string;
    providerEventId: string | null;
    providerMessageId: string | null;
    recipientEmail: string | null;
  }
) => ({
  deliveryStatus: derived.deliveryStatus,
  eventType: derived.eventType,
  provider: 'resend',
  providerCreatedAt: truncate(payload.created_at, 64),
  providerEventId: derived.providerEventId,
  providerMessageId: derived.providerMessageId,
  recipientEmailMasked: maskEmail(derived.recipientEmail),
  retention: 'minimized_90_days',
});

export const buildTwilioEventPayloadSnapshot = (
  params: Record<string, string>,
  derived: {
    deliveryStatus: string;
    eventType: string;
    fromPhone: string | null;
    messageSid: string | null;
    toPhone: string | null;
  }
) => ({
  deliveryStatus: derived.deliveryStatus,
  errorCode: truncate(params.ErrorCode, 64),
  eventType: derived.eventType,
  fromPhoneMasked: maskPhone(derived.fromPhone),
  provider: 'twilio',
  providerMessageId: derived.messageSid,
  retention: 'minimized_90_days',
  toPhoneMasked: maskPhone(derived.toPhone),
});

export const TWILIO_SMS_EVENT_UPSERT_SQL = `INSERT INTO sms_events (
       public_id, provider_code, provider_message_id, event_type_code, delivery_status_code,
       to_phone, from_phone, error_code, error_message, payload_json, received_at, created_at
     ) VALUES (?, 'twilio', ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE
       delivery_status_code = VALUES(delivery_status_code),
       to_phone = VALUES(to_phone),
       from_phone = VALUES(from_phone),
       error_code = VALUES(error_code),
       error_message = VALUES(error_message),
       payload_json = VALUES(payload_json),
       received_at = UTC_TIMESTAMP(6)`;

export const handleResendWebhook = async (input: {
  headers: {
    id?: string;
    signature?: string;
    timestamp?: string;
  };
  payload: Buffer;
}) => {
  verifyResendWebhookSignature({
    id: input.headers.id,
    payload: input.payload,
    secret: env.RESEND_WEBHOOK_SECRET,
    signature: input.headers.signature,
    timestamp: input.headers.timestamp,
  });

  let parsedPayload: ResendWebhookPayload;
  try {
    parsedPayload = JSON.parse(input.payload.toString('utf8')) as ResendWebhookPayload;
  } catch {
    throw forbidden('invalid_resend_payload', 'Invalid Resend webhook payload.');
  }

  const eventType = truncate(parsedPayload.type || 'unknown', 80) || 'unknown';
  const providerEventId = truncate(parsedPayload.id || input.headers.id, 160);
  const providerMessageId = truncate(parsedPayload.data?.email_id, 160);
  const deliveryStatus = mapResendStatus(eventType);
  const recipientEmail = truncate(extractResendRecipient(parsedPayload), 255);

  await executeStatement(
    `INSERT INTO email_events (
       public_id, provider_code, provider_event_id, provider_message_id, event_type_code,
       delivery_status_code, recipient_email, payload_json, received_at, created_at
     ) VALUES (?, 'resend', ?, ?, ?, ?, ?, CAST(? AS JSON), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE
       provider_message_id = VALUES(provider_message_id),
       event_type_code = VALUES(event_type_code),
       delivery_status_code = VALUES(delivery_status_code),
       recipient_email = VALUES(recipient_email),
       payload_json = VALUES(payload_json),
       received_at = UTC_TIMESTAMP(6)`,
    [
      createPublicId(),
      providerEventId,
      providerMessageId,
      eventType,
      deliveryStatus,
      recipientEmail,
      safeJson(
        buildResendEventPayloadSnapshot(parsedPayload, {
          deliveryStatus,
          eventType,
          providerEventId,
          providerMessageId,
          recipientEmail,
        })
      ),
    ]
  );

  return {
    provider: 'resend' as const,
    status: deliveryStatus,
  };
};

export const handleTwilioStatusWebhook = async (request: Request) => {
  const payload = request.body as TwilioStatusPayload;
  const params = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, getFirst(value)])
  );
  const signature = request.header('x-twilio-signature') || undefined;

  verifyTwilioWebhookSignature({
    authToken: env.TWILIO_WEBHOOK_AUTH_TOKEN || env.TWILIO_AUTH_TOKEN,
    params,
    signature,
    url: getTwilioWebhookUrl(request),
  });

  const messageSid = truncate(params.MessageSid || params.SmsSid || params.Sid, 160);
  const eventType = truncate(params.MessageStatus || params.SmsStatus || 'status_callback', 80) ||
    'status_callback';
  const deliveryStatus = mapTwilioStatus(eventType);
  const toPhone = truncate(params.To, 64);
  const fromPhone = truncate(params.From, 64);

  await executeStatement(
    TWILIO_SMS_EVENT_UPSERT_SQL,
    [
      createPublicId(),
      messageSid,
      eventType,
      deliveryStatus,
      toPhone,
      fromPhone,
      truncate(params.ErrorCode, 64),
      truncate(params.ErrorMessage, 255),
      safeJson(
        buildTwilioEventPayloadSnapshot(params, {
          deliveryStatus,
          eventType,
          fromPhone,
          messageSid,
          toPhone,
        })
      ),
    ]
  );

  return {
    provider: 'twilio' as const,
    status: deliveryStatus,
  };
};
