import { badRequest } from '../../lib/httpErrors.js';

export type ClientPasswordPolicyContext = {
  email?: string | null;
  fullName?: string | null;
};

const COMMON_PASSWORD_MESSAGE = 'Choose a less common password.';

const COMMON_PASSWORD_BLOCKLIST = new Set([
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
]);

const OBVIOUS_BUSINESS_TOKENS = ['admin', 'global', 'globallmg'];

const normalizePasswordToken = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const getIdentityTokens = (context: ClientPasswordPolicyContext) => {
  const tokens: string[] = [];
  const emailLocalPart = context.email?.split('@')[0] || '';
  const normalizedEmailLocalPart = normalizePasswordToken(emailLocalPart);

  if (normalizedEmailLocalPart.length >= 4) {
    tokens.push(normalizedEmailLocalPart);
  }

  const nameTokens = (context.fullName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizePasswordToken)
    .filter((token) => token.length >= 4);

  tokens.push(...nameTokens);
  return tokens;
};

const hasCommonPasswordSignal = (
  normalizedPasswordToken: string,
  context: ClientPasswordPolicyContext
) => {
  if (
    Array.from(COMMON_PASSWORD_BLOCKLIST).some((password) =>
      normalizedPasswordToken.includes(password)
    )
  ) {
    return true;
  }

  if (OBVIOUS_BUSINESS_TOKENS.some((token) => normalizedPasswordToken.includes(token))) {
    return true;
  }

  return getIdentityTokens(context).some((token) => normalizedPasswordToken.includes(token));
};

export const getClientPasswordStrengthIssues = (
  password: string,
  context: ClientPasswordPolicyContext = {}
) => {
  const issues: string[] = [];
  const normalizedPasswordToken = normalizePasswordToken(password);

  if (password.length < 12) {
    issues.push('Use at least 12 characters.');
  }

  if (!/[a-z]/.test(password)) {
    issues.push('Include a lowercase letter.');
  }

  if (!/[A-Z]/.test(password)) {
    issues.push('Include an uppercase letter.');
  }

  if (!/[0-9]/.test(password)) {
    issues.push('Include a number.');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    issues.push('Include a symbol.');
  }

  if (hasCommonPasswordSignal(normalizedPasswordToken, context)) {
    issues.push(COMMON_PASSWORD_MESSAGE);
  }

  return issues;
};

export const assertStrongClientPassword = (
  password: string,
  context: ClientPasswordPolicyContext = {}
) => {
  const issues = getClientPasswordStrengthIssues(password, context);

  if (issues.length > 0) {
    throw badRequest(
      'weak_password',
      'Password does not meet security requirements.',
      issues
    );
  }
};
