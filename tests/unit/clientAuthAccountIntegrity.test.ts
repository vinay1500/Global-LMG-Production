import { describe, expect, it } from 'vitest';
import { ApiError } from '../../backend/src/lib/httpErrors.js';
import { mergeGoogleIdentityWithAccount } from '../../backend/src/modules/auth/authService.js';
import {
  MysqlAuthStore,
  normalizeClientTypeCode,
  preserveVerifiedAt,
  resolveAccountLocalizationDefaults,
} from '../../backend/src/modules/auth/mysqlAuthStore.js';
import type { AuthAccountRecord } from '../../backend/src/modules/auth/types.js';

const baseAccount = {
  clientType: 'business',
  country: 'US',
  createdAt: '2026-05-01T00:00:00.000Z',
  email: 'client@example.com',
  fullName: 'Existing Client',
  id: 'usr_existing_client',
  isEmailVerified: false,
  isPhoneVerified: false,
  passwordHash: '',
  phone: '+15551234567',
  provider: 'email',
} satisfies AuthAccountRecord;

describe('client auth account integrity helpers', () => {
  it('does not let Google sign-in overwrite an existing account email or country', () => {
    const merged = mergeGoogleIdentityWithAccount(
      {
        ...baseAccount,
        country: 'CA',
        email: 'Client@Example.com',
        isEmailVerified: false,
      },
      {
        email: 'client@example.com',
        emailVerified: true,
        fullName: 'Google Profile Name',
        subject: 'google-subject-1',
      },
      'US'
    );

    expect(merged.email).toBe('Client@Example.com');
    expect(merged.country).toBe('CA');
    expect(merged.fullName).toBe('Existing Client');
    expect(merged.isEmailVerified).toBe(true);
    expect(merged.oauthSubject).toBe('google-subject-1');
  });

  it('rejects a Google identity when the linked account email differs', () => {
    expect(() =>
      mergeGoogleIdentityWithAccount(baseAccount, {
        email: 'other@example.com',
        emailVerified: true,
        fullName: 'Other Person',
        subject: 'google-subject-2',
      })
    ).toThrow(ApiError);
  });

  it('preserves verified timestamps unless verification actually occurs', () => {
    const existing = '2026-05-01 00:00:00.000000';
    const next = '2026-05-09 00:00:00.000000';

    expect(preserveVerifiedAt(existing, false, next)).toBe(existing);
    expect(preserveVerifiedAt(existing, true, next)).toBe(existing);
    expect(preserveVerifiedAt(null, false, next)).toBeNull();
    expect(preserveVerifiedAt(null, true, next)).toBe(next);
  });

  it('derives locale and timezone from country before platform defaults', () => {
    expect(resolveAccountLocalizationDefaults('US', 'Europe/London', 'en-GB')).toEqual({
      locale: 'en-US',
      timezone: 'America/New_York',
    });

    expect(resolveAccountLocalizationDefaults('', 'Europe/London', 'en-GB')).toEqual({
      locale: 'en-GB',
      timezone: 'Europe/London',
    });

    expect(resolveAccountLocalizationDefaults('', '', '')).toEqual({
      locale: 'en-US',
      timezone: 'UTC',
    });
  });

  it('normalizes supported client type codes', () => {
    expect(normalizeClientTypeCode('business')).toBe('business');
    expect(normalizeClientTypeCode('organization')).toBe('organization');
    expect(normalizeClientTypeCode(undefined)).toBe('individual');
    expect(normalizeClientTypeCode('unsupported')).toBe('individual');
  });
});

describe('MysqlAuthStore.saveAccount existing account updates', () => {
  it('preserves client legal/display/billing names and verified timestamps on routine saves', async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1, insertId: 1 }, []];
      },
      query: async (sql: string) => {
        if (sql.includes('FROM users WHERE public_id')) {
          return [[{ id: 42 }], []];
        }

        if (sql.includes('FROM client_accounts ca')) {
          return [[{ id: 7 }], []];
        }

        if (sql.includes('FROM client_addresses')) {
          return [[{ id: 9 }], []];
        }

        return [[], []];
      },
      release: () => undefined,
      rollback: async () => undefined,
    };
    const pool = {
      getConnection: async () => connection,
    };
    class TestMysqlAuthStore extends MysqlAuthStore {
      public override async initialize() {
        return undefined;
      }
    }
    const store = new TestMysqlAuthStore(pool as never);

    await store.saveAccount({
      ...baseAccount,
      fullName: 'New Login-Time Name',
      isEmailVerified: true,
      isPhoneVerified: true,
      lastLoginAt: '2026-05-09T10:00:00.000Z',
    });

    const userUpdate = executed.find((entry) => entry.sql.includes('UPDATE users'));
    const clientAccountUpdate = executed.find((entry) =>
      entry.sql.includes('UPDATE client_accounts')
    );

    expect(userUpdate?.sql).toContain('email_verified_at = CASE');
    expect(userUpdate?.sql).toContain('phone_verified_at = CASE');
    expect(clientAccountUpdate?.sql).not.toContain('legal_name');
    expect(clientAccountUpdate?.sql).not.toContain('display_name');
    expect(clientAccountUpdate?.sql).not.toContain('billing_name');
  });
});
