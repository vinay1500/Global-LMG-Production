import {
  GOOGLE_CAREERS_FORM_URL,
  GOOGLE_CONTACT_FORM_URL,
  GOOGLE_INTAKE_FORM_URL,
  GOOGLE_PARTNER_FORM_URL,
} from './runtime';

export type LaunchFormLink = {
  fallbackMessage: string;
  isConfigured: boolean;
  url: string | null;
};

export const CLIENT_INTAKE_WARNING =
  'Use the authenticated portal or another approved secure channel for sensitive, regulated, or payment-related information.';

export const FORM_UNAVAILABLE_MESSAGE =
  'The intake form is being finalized. Please contact us through the client portal or contact page.';

const TRUSTED_GOOGLE_FORM_HOSTS = new Set(['docs.google.com', 'forms.gle']);
const BLOCKED_FORM_URL_MARKERS = ['phase0', 'dummy', 'placeholder', 'temporary'];

const hasBlockedMarker = (value: string) => {
  const normalized = value.toLowerCase();
  return BLOCKED_FORM_URL_MARKERS.some((marker) => normalized.includes(marker));
};

const isTrustedGoogleFormPath = (url: URL) => {
  if (url.hostname === 'docs.google.com') {
    return url.pathname.startsWith('/forms/');
  }

  return url.hostname === 'forms.gle' && url.pathname.length > 1;
};

const getTrustedGoogleFormUrl = (candidateUrl: string | undefined): string | null => {
  if (!candidateUrl || hasBlockedMarker(candidateUrl)) {
    return null;
  }

  try {
    const parsedUrl = new URL(candidateUrl);

    if (parsedUrl.protocol !== 'https:') {
      return null;
    }

    if (!TRUSTED_GOOGLE_FORM_HOSTS.has(parsedUrl.hostname)) {
      return null;
    }

    if (!isTrustedGoogleFormPath(parsedUrl)) {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
};

const createLaunchFormLink = (
  candidateUrl: string | undefined,
  fallbackMessage = FORM_UNAVAILABLE_MESSAGE
): LaunchFormLink => {
  const url = getTrustedGoogleFormUrl(candidateUrl);
  return {
    fallbackMessage,
    isConfigured: url !== null,
    url,
  };
};

export const CLIENT_INTAKE_FORM_LINK = createLaunchFormLink(GOOGLE_INTAKE_FORM_URL);
export const CAREERS_FORM_LINK = createLaunchFormLink(
  GOOGLE_CAREERS_FORM_URL,
  'The careers form is being finalized. Please contact us through the client portal or contact page.'
);
export const CONTACT_FORM_LINK = createLaunchFormLink(GOOGLE_CONTACT_FORM_URL);
export const PARTNER_FORM_LINK = createLaunchFormLink(GOOGLE_PARTNER_FORM_URL);
