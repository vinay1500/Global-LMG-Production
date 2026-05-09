import { describe, expect, it } from 'vitest';
import {
  isValidGstin,
  normalizeGstin,
} from '../../admin_backend/src/modules/settings/gstin';

describe('GSTIN validation helpers', () => {
  it('accepts a valid 15-character Indian GSTIN', () => {
    expect(isValidGstin('27ABCDE1234F1Z5')).toBe(true);
  });

  it('normalizes lowercase GSTIN input before validation', () => {
    const normalized = normalizeGstin('27abcde1234f1z5');

    expect(normalized).toBe('27ABCDE1234F1Z5');
    expect(normalized && isValidGstin(normalized)).toBe(true);
  });

  it('rejects invalid GSTIN formats', () => {
    const normalized = normalizeGstin('27ABCDE1234F0Z5');

    expect(normalized).toBe('27ABCDE1234F0Z5');
    expect(normalized && isValidGstin(normalized)).toBe(false);
  });

  it('allows empty GSTIN when not applicable', () => {
    expect(normalizeGstin('')).toBeNull();
    expect(normalizeGstin('   ')).toBeNull();
    expect(normalizeGstin(null)).toBeNull();
  });
});
