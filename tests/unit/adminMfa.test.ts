import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

type MfaModule = typeof import('../../admin_backend/src/modules/auth/mfa.js');
type PlatformSettingsModule = typeof import('../../admin_backend/src/modules/settings/platformSettings.js');

const originalEnv = { ...process.env };

const setProcessEnv = (nextEnv: NodeJS.ProcessEnv) => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, nextEnv);
};

const loadMfaModule = async () => {
  vi.resetModules();
  setProcessEnv({
    ...originalEnv,
    APP_ENV: 'development',
    AUTH_SESSION_SECRET: 'unit-test-admin-session-secret-with-more-than-thirty-two-chars',
    CALENDAR_ADMIN_AUTH_MODE: 'workspace_delegation',
    CALENDAR_SYNC_MODE: 'disabled',
    DOCUMENT_STORAGE_DRIVER: 'local',
    EMAIL_PROVIDER_MODE: 'disabled',
    FILE_SCAN_MODE: 'disabled',
    OBJECT_STORAGE_DRIVER: 'local',
    SMS_PROVIDER_MODE: 'disabled',
  });

  return {
    mfa: (await import('../../admin_backend/src/modules/auth/mfa.js')) as MfaModule,
    platformSettings: (await import(
      '../../admin_backend/src/modules/settings/platformSettings.js'
    )) as PlatformSettingsModule,
  };
};

const decodeBase32 = (value: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';

  for (const character of value.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index === -1) {
      throw new Error(`Invalid base32 character ${character}`);
    }
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
};

const createTotpCode = (secret: string, epochMs = Date.now()) => {
  const counter = Math.floor(epochMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
};

afterEach(() => {
  setProcessEnv(originalEnv);
  vi.resetModules();
});

describe('admin MFA helpers', () => {
  it('encrypts and decrypts TOTP secrets without storing the secret as plaintext', async () => {
    const { mfa } = await loadMfaModule();

    const secret = mfa.createAdminTotpSecret();
    const encrypted = mfa.encryptAdminMfaSecret(secret);

    expect(encrypted).not.toContain(secret);
    expect(mfa.decryptAdminMfaSecret(encrypted)).toBe(secret);
  });

  it('builds a provisioning URI and validates a current TOTP code', async () => {
    const { mfa } = await loadMfaModule();

    const secret = mfa.createAdminTotpSecret();
    const uri = mfa.buildAdminTotpUri('Admin@GlobalLMG.org', secret);
    const code = createTotpCode(secret);

    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('Global%20LMG%20Admin');
    expect(mfa.verifyAdminTotpCode(secret, code)).toBe(true);
    expect(mfa.verifyAdminTotpCode(secret, '000000')).toBe(false);
  });

  it('hashes recovery codes and compares normalized user input safely', async () => {
    const { mfa } = await loadMfaModule();

    const recoveryCode = 'ABCDE-12345';
    const hash = mfa.hashAdminMfaRecoveryCode(recoveryCode);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mfa.recoveryCodeHashMatches('abcde 12345', hash)).toBe(true);
    expect(mfa.recoveryCodeHashMatches('ABCDE-54321', hash)).toBe(false);
  });

  it('normalizes staged MFA rollout modes defensively', async () => {
    const { platformSettings } = await loadMfaModule();

    expect(platformSettings.normalizeAdminMfaRequirementMode('off')).toBe('off');
    expect(platformSettings.normalizeAdminMfaRequirementMode('warn')).toBe('warn');
    expect(platformSettings.normalizeAdminMfaRequirementMode('enforce')).toBe('enforce');
    expect(platformSettings.normalizeAdminMfaRequirementMode(' ENFORCE ')).toBe('enforce');
    expect(platformSettings.normalizeAdminMfaRequirementMode('unexpected')).toBe('off');
    expect(platformSettings.normalizeAdminMfaRequirementMode(null)).toBe('off');
  });
});
