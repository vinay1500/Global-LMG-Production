import { env } from '../../config/env.js';
import { providerFetch } from '../../lib/providerHttp.js';
import type { ProviderDeliveryResult, SendEmailInput } from './types.js';

const truncate = (value: string, maxLength = 255) =>
  value.length > maxLength ? value.slice(0, maxLength - 1) : value;

const safeErrorMessage = (error: unknown) =>
  error instanceof Error ? truncate(error.message) : 'Email provider request failed.';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const textToHtml = (value: string) => `<p>${escapeHtml(value).replace(/\n/g, '<br />')}</p>`;

export const sendEmail = async (input: SendEmailInput): Promise<ProviderDeliveryResult> => {
  if (env.EMAIL_PROVIDER_MODE === 'disabled') {
    return {
      providerCode: 'disabled',
      status: 'disabled',
    };
  }

  if (env.EMAIL_PROVIDER_MODE === 'preview') {
    return {
      providerCode: 'preview',
      status: 'preview',
    };
  }

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM_ADDRESS) {
    return {
      errorMessage: 'Email provider is missing required configuration.',
      providerCode: 'resend',
      status: 'failed',
    };
  }

  try {
    const response = await providerFetch('https://api.resend.com/emails', {
      method: 'POST',
      operation: 'send_email',
      providerCode: 'resend',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      safeToRetry: false,
      body: JSON.stringify({
        from: env.EMAIL_FROM_ADDRESS,
        html: input.html || textToHtml(input.text),
        subject: input.subject,
        text: input.text,
        to: [input.to],
      }),
    });

    if (!response.ok) {
      return {
        errorMessage: `Resend rejected the email request with status ${response.status}.`,
        providerCode: 'resend',
        status: 'failed',
      };
    }

    const payload = (await response.json()) as { id?: string };

    return {
      providerCode: 'resend',
      providerReference: payload.id,
      status: 'sent',
    };
  } catch (error) {
    return {
      errorMessage: safeErrorMessage(error),
      providerCode: 'resend',
      status: 'failed',
    };
  }
};
