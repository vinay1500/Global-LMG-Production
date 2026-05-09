import { env } from '../../config/env.js';
import { providerFetch } from '../../lib/providerHttp.js';
import type { ProviderDeliveryResult, SendSmsInput } from './types.js';

const truncate = (value: string, maxLength = 255) =>
  value.length > maxLength ? value.slice(0, maxLength - 1) : value;

const safeErrorMessage = (error: unknown) =>
  error instanceof Error ? truncate(error.message) : 'SMS provider request failed.';

const buildAuthHeader = () =>
  `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;

export const sendSms = async (input: SendSmsInput): Promise<ProviderDeliveryResult> => {
  if (env.SMS_PROVIDER_MODE === 'disabled') {
    return {
      providerCode: 'disabled',
      status: 'disabled',
    };
  }

  if (env.SMS_PROVIDER_MODE === 'preview') {
    return {
      providerCode: 'preview',
      status: 'preview',
    };
  }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return {
      errorMessage: 'SMS provider is missing required account configuration.',
      providerCode: 'twilio',
      status: 'failed',
    };
  }

  if (!env.TWILIO_FROM_NUMBER && !env.TWILIO_MESSAGING_SERVICE_SID) {
    return {
      errorMessage: 'SMS provider is missing an outbound sender.',
      providerCode: 'twilio',
      status: 'failed',
    };
  }

  const body = new URLSearchParams({
    Body: input.body,
    To: input.to,
  });

  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    body.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    body.set('From', env.TWILIO_FROM_NUMBER || '');
  }

  try {
    const response = await providerFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
        env.TWILIO_ACCOUNT_SID
      )}/Messages.json`,
      {
        method: 'POST',
        operation: 'send_sms',
        providerCode: 'twilio',
        headers: {
          Authorization: buildAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        safeToRetry: false,
        body,
      }
    );

    if (!response.ok) {
      return {
        errorMessage: `Twilio rejected the SMS request with status ${response.status}.`,
        providerCode: 'twilio',
        status: 'failed',
      };
    }

    const payload = (await response.json()) as { sid?: string };

    return {
      providerCode: 'twilio',
      providerReference: payload.sid,
      status: 'sent',
    };
  } catch (error) {
    return {
      errorMessage: safeErrorMessage(error),
      providerCode: 'twilio',
      status: 'failed',
    };
  }
};
