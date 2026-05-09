import { env } from '../../../config/env.js';
import { serviceUnavailable } from '../../../lib/httpErrors.js';
import { providerFetch } from '../../../lib/providerHttp.js';
import type {
  DeliveryResult,
  SendSmsCodeInput,
  VerifySmsCodeInput,
  VerifySmsCodeResult,
} from './types.js';

const buildVerifyEndpoint = () =>
  `https://verify.twilio.com/v2/Services/${encodeURIComponent(
    env.TWILIO_VERIFY_SERVICE_SID || ''
  )}/Verifications`;

const buildVerifyCheckEndpoint = () =>
  `https://verify.twilio.com/v2/Services/${encodeURIComponent(
    env.TWILIO_VERIFY_SERVICE_SID || ''
  )}/VerificationCheck`;

const buildMessagesEndpoint = () =>
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    env.TWILIO_ACCOUNT_SID || ''
  )}/Messages.json`;

const buildAuthHeader = () =>
  `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`;

const buildOtpMessage = (code: string) =>
  `Global LMG verification code: ${code}. This code expires shortly. If you did not request this, please ignore it.`;

export const smsAuthProvider = {
  async sendCode(input: SendSmsCodeInput): Promise<DeliveryResult> {
    if (env.SMS_PROVIDER_MODE === 'preview') {
      return {
        deliveryHint: `Preview OTP for ${input.recipientPhone}: ${input.code || '******'}`,
      };
    }

    if (env.SMS_PROVIDER_MODE === 'disabled') {
      throw serviceUnavailable(
        'sms_provider_disabled',
        'SMS delivery is not available right now.'
      );
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw serviceUnavailable(
        'sms_provider_misconfigured',
        'SMS provider is missing required configuration.'
      );
    }

    if (env.SMS_PROVIDER_MODE === 'twilio') {
      if (!input.code) {
        throw serviceUnavailable(
          'sms_provider_misconfigured',
          'SMS provider requires a locally generated verification code.'
        );
      }

      if (!env.TWILIO_FROM_NUMBER && !env.TWILIO_MESSAGING_SERVICE_SID) {
        throw serviceUnavailable(
          'sms_provider_misconfigured',
          'SMS provider is missing an outbound sender.'
        );
      }

      const body = new URLSearchParams({
        Body: buildOtpMessage(input.code),
        To: input.recipientPhone,
      });

      if (env.TWILIO_MESSAGING_SERVICE_SID) {
        body.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
      } else {
        body.set('From', env.TWILIO_FROM_NUMBER || '');
      }

      const response = await providerFetch(buildMessagesEndpoint(), {
        method: 'POST',
        operation: 'send_auth_sms',
        providerCode: 'twilio',
        headers: {
          Authorization: buildAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        safeToRetry: false,
        body,
      });

      if (!response.ok) {
        throw serviceUnavailable(
          'sms_provider_failed',
          `SMS provider rejected the request with status ${response.status}.`
        );
      }

      const payload = (await response.json()) as { sid?: string };

      return {
        providerReference: payload.sid,
      };
    }

    if (!env.TWILIO_VERIFY_SERVICE_SID) {
      throw serviceUnavailable(
        'sms_provider_misconfigured',
        'SMS provider is missing required Verify Service configuration.'
      );
    }

    const body = new URLSearchParams({
      Channel: 'sms',
      To: input.recipientPhone,
    });

    const response = await providerFetch(buildVerifyEndpoint(), {
      method: 'POST',
      operation: 'send_twilio_verify_sms',
      providerCode: 'twilio',
      headers: {
        Authorization: buildAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      safeToRetry: false,
      body,
    });

    if (!response.ok) {
      throw serviceUnavailable(
        'sms_provider_failed',
        `SMS provider rejected the request with status ${response.status}.`
      );
    }

    const payload = (await response.json()) as { sid?: string };

    return {
      providerReference: payload.sid,
    };
  },

  async verifyCode(input: VerifySmsCodeInput): Promise<VerifySmsCodeResult> {
    if (env.SMS_PROVIDER_MODE === 'preview') {
      return {
        approved: true,
        providerReference: input.providerReference,
        status: 'approved',
      };
    }

    if (env.SMS_PROVIDER_MODE === 'disabled') {
      throw serviceUnavailable(
        'sms_provider_disabled',
        'SMS delivery is not available right now.'
      );
    }

    if (env.SMS_PROVIDER_MODE !== 'twilio-verify') {
      throw serviceUnavailable(
        'sms_provider_misconfigured',
        'SMS verification checks require TWILIO_VERIFY_SERVICE_SID.'
      );
    }

    if (
      !env.TWILIO_ACCOUNT_SID ||
      !env.TWILIO_AUTH_TOKEN ||
      !env.TWILIO_VERIFY_SERVICE_SID
    ) {
      throw serviceUnavailable(
        'sms_provider_misconfigured',
        'SMS provider is missing required configuration.'
      );
    }

    const body = new URLSearchParams({
      Code: input.code,
      To: input.recipientPhone,
    });

    const response = await providerFetch(buildVerifyCheckEndpoint(), {
      method: 'POST',
      operation: 'check_twilio_verify_code',
      providerCode: 'twilio',
      headers: {
        Authorization: buildAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      safeToRetry: false,
      body,
    });

    if (!response.ok) {
      throw serviceUnavailable(
        'sms_provider_failed',
        `SMS provider rejected the request with status ${response.status}.`
      );
    }

    const payload = (await response.json()) as { sid?: string; status?: string };

    return {
      approved: payload.status === 'approved',
      providerReference: payload.sid || input.providerReference,
      status: payload.status,
    };
  },
};
