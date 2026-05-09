import { describe, expect, it } from 'vitest';
import {
  getAdminPasswordStrengthIssues,
  validateStrongPassword,
} from '../../admin_backend/src/modules/auth/passwordPolicy.js';

const actor = {
  displayName: 'Riya Operations',
  email: 'riya.ops@example.com',
};

describe('admin password policy', () => {
  it('accepts a strong password that avoids identity tokens', () => {
    expect(getAdminPasswordStrengthIssues('Violet#Ledger42', actor)).toEqual([]);
    expect(() => validateStrongPassword('Violet#Ledger42', actor)).not.toThrow();
  });

  it('keeps forced-rotation password candidates on the same strong-password path', () => {
    expect(() => validateStrongPassword('Cerulean#Vault84', actor)).not.toThrow();
  });

  it('requires length, character classes, and symbols', () => {
    const issues = getAdminPasswordStrengthIssues('short', actor);

    expect(issues).toContain('Use at least 12 characters.');
    expect(issues).toContain('Include an uppercase letter.');
    expect(issues).toContain('Include a number.');
    expect(issues).toContain('Include a symbol.');
  });

  it('rejects common passwords even when punctuation or casing varies', () => {
    expect(getAdminPasswordStrengthIssues('Password123!', actor)).toContain(
      'Choose a less common password.'
    );
    expect(getAdminPasswordStrengthIssues('Welcome123!', actor)).toContain(
      'Choose a less common password.'
    );
  });

  it('rejects passwords containing the admin email username or display name with a generic issue', () => {
    expect(getAdminPasswordStrengthIssues('Riya#Ledger42', actor)).toContain(
      'Choose a less common password.'
    );
    expect(getAdminPasswordStrengthIssues('riya.ops#Ledger42', actor)).toContain(
      'Choose a less common password.'
    );
  });

  it('rejects obvious Global LMG and admin terms', () => {
    expect(getAdminPasswordStrengthIssues('Global#Ledger42', actor)).toContain(
      'Choose a less common password.'
    );
    expect(getAdminPasswordStrengthIssues('Admin#Ledger42', actor)).toContain(
      'Choose a less common password.'
    );
    expect(getAdminPasswordStrengthIssues('Globallmg#42Vault', actor)).toContain(
      'Choose a less common password.'
    );
  });
});
