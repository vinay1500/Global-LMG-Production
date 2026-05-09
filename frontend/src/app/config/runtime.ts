const DEFAULT_PUBLIC_SITE_URL = 'https://www.globallmg.org';
const DEFAULT_API_BASE_URL = '/api';

const getOptionalString = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getAbsoluteUrl = (value: string | undefined, fallbackValue: string) => {
  if (!value) {
    return fallbackValue;
  }

  try {
    return new URL(value).toString();
  } catch {
    return fallbackValue;
  }
};

const getApiBaseUrl = (value: string | undefined) => {
  if (!value) {
    return DEFAULT_API_BASE_URL;
  }

  if (value.startsWith('/')) {
    return value;
  }

  try {
    return new URL(value).toString();
  } catch {
    return DEFAULT_API_BASE_URL;
  }
};

export const PUBLIC_SITE_URL = getAbsoluteUrl(
  import.meta.env.VITE_PUBLIC_SITE_URL,
  DEFAULT_PUBLIC_SITE_URL
);
export const API_BASE_URL = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
export const GOOGLE_CLIENT_ID = getOptionalString(import.meta.env.VITE_GOOGLE_CLIENT_ID);
export const GOOGLE_MAPS_API_KEY = getOptionalString(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
export const ADDRESS_AUTOCOMPLETE_MODE =
  import.meta.env.VITE_ADDRESS_AUTOCOMPLETE_MODE === 'google' ? 'google' : 'disabled';
export const GOOGLE_INTAKE_FORM_URL = getOptionalString(import.meta.env.VITE_GOOGLE_INTAKE_FORM_URL);
export const GOOGLE_CAREERS_FORM_URL = getOptionalString(
  import.meta.env.VITE_GOOGLE_CAREERS_FORM_URL
);
export const GOOGLE_CONTACT_FORM_URL = getOptionalString(
  import.meta.env.VITE_GOOGLE_CONTACT_FORM_URL
);
export const GOOGLE_PARTNER_FORM_URL = getOptionalString(
  import.meta.env.VITE_GOOGLE_PARTNER_FORM_URL
);
