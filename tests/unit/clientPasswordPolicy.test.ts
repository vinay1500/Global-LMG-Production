import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertStrongClientPassword,
  getClientPasswordStrengthIssues,
} from '../../backend/src/modules/auth/passwordPolicy.js';

const actor = {
  email: 'maya.client@example.com',
  fullName: 'Maya Client',
};

const authRoutes = readFileSync(resolve(process.cwd(), 'backend/src/routes/auth.ts'), 'utf8');
const authService = readFileSync(
  resolve(process.cwd(), 'backend/src/modules/auth/authService.ts'),
  'utf8'
);

const extractBlock = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('client password policy', () => {
  it('accepts a strong client password that avoids identity tokens', () => {
    expect(getClientPasswordStrengthIssues('Violet#Ledger42', actor)).toEqual([]);
    expect(() => assertStrongClientPassword('Violet#Ledger42', actor)).not.toThrow();
  });

  it('rejects short passwords and missing character classes', () => {
    const issues = getClientPasswordStrengthIssues('short', actor);

    expect(issues).toContain('Use at least 12 characters.');
    expect(issues).toContain('Include an uppercase letter.');
    expect(issues).toContain('Include a number.');
    expect(issues).toContain('Include a symbol.');
  });

  it('rejects common passwords and obvious Global LMG terms', () => {
    expect(getClientPasswordStrengthIssues('Password123!', actor)).toContain(
      'Choose a less common password.'
    );
    expect(getClientPasswordStrengthIssues('Globallmg#42Vault', actor)).toContain(
      'Choose a less common password.'
    );
  });

  it('rejects passwords containing the client email username or name', () => {
    expect(getClientPasswordStrengthIssues('maya.client#Vault42', actor)).toContain(
      'Choose a less common password.'
    );
    expect(getClientPasswordStrengthIssues('Maya#Ledger42', actor)).toContain(
      'Choose a less common password.'
    );
  });

  it('keeps sign-in on presence validation instead of strength validation', () => {
    const block = extractBlock(authRoutes, 'const signInSchema = z.object({', '});');

    expect(block).toContain('password: z.string().min(1).max(200)');
    expect(block).not.toContain('password: z.string().min(12)');
  });

  it('enforces strong passwords for signup and password reset in the service layer', () => {
    const signUpBlock = extractBlock(authService, 'async signUp(payload:', 'const account: AuthAccountRecord');
    const resetBlock = extractBlock(authService, 'async resetPassword(', 'await store.saveAccount({');

    expect(signUpBlock).toContain('assertStrongClientPassword(payload.password');
    expect(signUpBlock).toContain('email: normalizedEmail');
    expect(signUpBlock).toContain('fullName: payload.fullName');
    expect(resetBlock).toContain('assertStrongClientPassword(payload.password');
    expect(resetBlock).toContain('email: account.email');
    expect(resetBlock).toContain('fullName: account.fullName');
  });
});
