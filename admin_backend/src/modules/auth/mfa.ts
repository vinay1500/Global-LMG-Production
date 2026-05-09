import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../config/env.js';
import { createRandomToken, hashOpaqueValue } from '../../lib/authCrypto.js';

const MFA_ISSUER = 'Global LMG Admin';
const ENCRYPTION_VERSION = 'v1';

const getEncryptionKey = () => createHash('sha256').update(env.AUTH_SESSION_SECRET).digest();

export const encryptAdminMfaSecret = (secret: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
};

export const decryptAdminMfaSecret = (encrypted: string) => {
  const [version, encodedIv, encodedTag, encodedCiphertext] = encrypted.split(':');

  if (version !== ENCRYPTION_VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error('Invalid MFA secret envelope.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(encodedIv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

export const createAdminTotpSecret = () => generateSecret();

export const buildAdminTotpUri = (email: string, secret: string) =>
  generateURI({
    issuer: MFA_ISSUER,
    label: email.trim().toLowerCase(),
    secret,
  });

export const buildAdminTotpQrDataUrl = (provisioningUri: string) =>
  QRCode.toDataURL(provisioningUri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
  });

export const verifyAdminTotpCode = (secret: string, code: string) => {
  const normalized = code.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  return verifySync({ secret, token: normalized }).valid;
};

export const normalizeRecoveryCode = (code: string) =>
  code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const formatRecoveryCode = (value: string) => `${value.slice(0, 5)}-${value.slice(5, 10)}`;

export const createAdminMfaRecoveryCodes = (count = 10) =>
  Array.from({ length: count }, () =>
    formatRecoveryCode(
      createRandomToken(8)
        .replace(/[^A-Za-z0-9]/g, '')
        .toUpperCase()
        .padEnd(10, '0')
        .slice(0, 10)
    )
  );

export const hashAdminMfaRecoveryCode = (code: string) =>
  hashOpaqueValue(normalizeRecoveryCode(code), env.AUTH_SESSION_SECRET);

export const recoveryCodeHashMatches = (code: string, hash: string) => {
  const actual = Buffer.from(hashAdminMfaRecoveryCode(code), 'hex');
  const expected = Buffer.from(hash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
