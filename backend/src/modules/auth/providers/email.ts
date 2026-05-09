import { env } from '../../../config/env.js';
import { serviceUnavailable } from '../../../lib/httpErrors.js';
import { providerFetch } from '../../../lib/providerHttp.js';
import type { DeliveryResult, SendEmailCodeInput } from './types.js';

const buildSubject = (purpose: SendEmailCodeInput['purpose']) =>
  purpose === 'password_reset'
    ? 'Global LMG password reset code'
    : 'Global LMG verification code';

const buildBodyText = (input: SendEmailCodeInput) => {
  const intro =
    input.purpose === 'password_reset'
      ? 'Use this code to reset your Global LMG password.'
      : 'Use this code to verify your Global LMG account.';

  return `${intro}\n\nCode: ${input.code}\n\nThis code will expire shortly. If you did not request this, please ignore this email.`;
};

export const emailAuthProvider = {
  async sendCode(input: SendEmailCodeInput): Promise<DeliveryResult> {
    if (env.EMAIL_PROVIDER_MODE === 'preview') {
      return {
        deliveryHint: `Preview ${
          input.purpose === 'password_reset' ? 'reset code' : 'verification code'
        } for ${input.recipientEmail}: ${input.code}`,
      };
    }

    if (env.EMAIL_PROVIDER_MODE === 'disabled') {
      throw serviceUnavailable(
        'email_provider_disabled',
        'Email delivery is not available right now.'
      );
    }

    if (!env.RESEND_API_KEY || !env.EMAIL_FROM_ADDRESS) {
      throw serviceUnavailable(
        'email_provider_misconfigured',
        'Email provider is missing required configuration.'
      );
    }

    const response = await providerFetch('https://api.resend.com/emails', {
      method: 'POST',
      operation: 'send_auth_code_email',
      providerCode: 'resend',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      safeToRetry: false,
      body: JSON.stringify({
        from: env.EMAIL_FROM_ADDRESS,
        html: `<p>${buildBodyText(input).replace(/\n/g, '<br />')}</p>`,
        subject: buildSubject(input.purpose),
        text: buildBodyText(input),
        to: [input.recipientEmail],
      }),
    });

    if (!response.ok) {
      throw serviceUnavailable(
        'email_provider_failed',
        `Email provider rejected the request with status ${response.status}.`
      );
    }

    const body = (await response.json()) as { id?: string };

    return {
      providerReference: body.id,
    };
  },
};
