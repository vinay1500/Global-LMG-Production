import { parsePhoneNumberFromString } from 'libphonenumber-js';

export const AUTH_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_REGEX = /^[\p{L}][\p{L}\p{M}\s'.-]{1,79}$/u;
const COMPANY_REGEX = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\s&'.,()-]{1,99}$/u;
const ROLE_REGEX = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\s&'.,()/+-]{1,79}$/u;

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const normalizePhone = (value: string) => {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');

  return `${hasPlus ? '+' : ''}${digits}`;
};

export const trimField = (value: string) => value.trim().replace(/\s+/g, ' ');

export const isValidEmail = (value: string) => AUTH_EMAIL_REGEX.test(normalizeEmail(value));

export const isValidPhone = (value: string) => {
  const normalized = normalizePhone(value);
  if (!normalized.startsWith('+')) {
    return false;
  }

  const parsedPhone = parsePhoneNumberFromString(normalized);
  return Boolean(parsedPhone?.isPossible());
};

export const isValidFullName = (value: string) => NAME_REGEX.test(trimField(value));

export const isValidCompanyName = (value: string) =>
  value.trim().length === 0 || COMPANY_REGEX.test(trimField(value));

export const isValidRole = (value: string) =>
  value.trim().length === 0 || ROLE_REGEX.test(trimField(value));

export const getPasswordStrengthErrors = (
  value: string,
  context: { email?: string; name?: string } = {}
) => {
  const errors: string[] = [];
  const normalizedPassword = value.toLowerCase().replace(/[^a-z0-9]+/g, '');

  if (value.length < 12) {
    errors.push('Password must be at least 12 characters long.');
  }
  if (!/[A-Z]/.test(value)) {
    errors.push('Password must include at least one uppercase letter.');
  }
  if (!/[a-z]/.test(value)) {
    errors.push('Password must include at least one lowercase letter.');
  }
  if (!/\d/.test(value)) {
    errors.push('Password must include at least one number.');
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    errors.push('Password must include at least one symbol.');
  }

  const commonSignals = [
    'admin123',
    'admin123456',
    'changeme',
    'defaultpassword',
    'letmein',
    'password',
    'password1',
    'password123',
    'qwerty',
    'qwerty123',
    'welcome',
    'welcome123',
    'admin',
    'global',
    'globallmg',
  ];
  const emailLocalPart = context.email?.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]+/g, '') || '';
  const nameTokens = (context.name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.replace(/[^a-z0-9]+/g, ''))
    .filter((token) => token.length >= 4);

  if (
    commonSignals.some((signal) => normalizedPassword.includes(signal)) ||
    (emailLocalPart.length >= 4 && normalizedPassword.includes(emailLocalPart)) ||
    nameTokens.some((token) => normalizedPassword.includes(token))
  ) {
    errors.push('Choose a less common password.');
  }

  return errors;
};
