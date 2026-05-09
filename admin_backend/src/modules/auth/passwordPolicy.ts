export type PasswordPolicyActor = {
  displayName: string;
  email: string;
};

export class PasswordPolicyError extends Error {
  public readonly code = 'password_strength_failed';
  public readonly statusCode = 400;

  constructor(public readonly issues: string[]) {
    super('The new password does not meet admin security requirements.');
  }
}

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

const normalizePasswordToken = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const hasCommonPasswordSignal = (
  normalizedPasswordToken: string,
  actor: PasswordPolicyActor
) => {
  const emailLocalPart = actor.email.split('@')[0]?.toLowerCase() || '';
  const normalizedEmailLocalPart = normalizePasswordToken(emailLocalPart);
  const displayTokens = actor.displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(normalizePasswordToken)
    .filter((token) => token.length >= 4);

  if (
    Array.from(COMMON_PASSWORD_BLOCKLIST).some((password) =>
      normalizedPasswordToken.includes(password)
    )
  ) {
    return true;
  }

  if (
    OBVIOUS_BUSINESS_TOKENS.some((token) => normalizedPasswordToken.includes(token)) ||
    (normalizedEmailLocalPart.length >= 4 && normalizedPasswordToken.includes(normalizedEmailLocalPart)) ||
    displayTokens.some((token) => normalizedPasswordToken.includes(token))
  ) {
    return true;
  }

  return false;
};

export const getAdminPasswordStrengthIssues = (
  newPassword: string,
  actor: PasswordPolicyActor
) => {
  const issues: string[] = [];
  const normalizedPasswordToken = normalizePasswordToken(newPassword);

  if (newPassword.length < 12) {
    issues.push('Use at least 12 characters.');
  }

  if (!/[a-z]/.test(newPassword)) {
    issues.push('Include a lowercase letter.');
  }

  if (!/[A-Z]/.test(newPassword)) {
    issues.push('Include an uppercase letter.');
  }

  if (!/[0-9]/.test(newPassword)) {
    issues.push('Include a number.');
  }

  if (!/[^A-Za-z0-9]/.test(newPassword)) {
    issues.push('Include a symbol.');
  }

  if (hasCommonPasswordSignal(normalizedPasswordToken, actor)) {
    issues.push(COMMON_PASSWORD_MESSAGE);
  }

  return issues;
};

// TODO: If breach-corpus checks are added later, use HIBP k-anonymity in an explicit
// opt-in mode so raw passwords are never sent to external services.

export const validateStrongPassword = (
  newPassword: string,
  actor: PasswordPolicyActor
) => {
  const issues = getAdminPasswordStrengthIssues(newPassword, actor);

  if (issues.length > 0) {
    throw new PasswordPolicyError(issues);
  }
};
