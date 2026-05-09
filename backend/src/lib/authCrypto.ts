import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const SCRYPT_KEY_LENGTH = 64;

const toBase64Url = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64');
};

export const timingSafeStringEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const createRandomToken = (size = 32) => toBase64Url(randomBytes(size));

export const createNumericCode = (length = 6) => {
  const digits = Array.from(randomBytes(length), (value) => String(value % 10)).join('');
  return digits.slice(0, length);
};

export const hashOpaqueValue = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('hex');

export const hashOneTimeCode = (value: string, secret: string) =>
  createHash('sha256').update(`${secret}:${value}`).digest('hex');

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt$${toBase64Url(salt)}$${toBase64Url(derivedKey)}`;
};

export const verifyPassword = async (password: string, storedHash: string) => {
  const [algorithm, encodedSalt, encodedHash] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !encodedSalt || !encodedHash) {
    return false;
  }

  const salt = fromBase64Url(encodedSalt);
  const expected = fromBase64Url(encodedHash);
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const createSignedCsrfToken = (secret: string) => {
  const nonce = createRandomToken(18);
  const signature = hashOpaqueValue(nonce, secret);
  return `${nonce}.${signature}`;
};

export const verifySignedCsrfToken = (token: string, secret: string) => {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const [nonce, signature] = parts;

  if (!nonce || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  return timingSafeStringEqual(hashOpaqueValue(nonce, secret), signature.toLowerCase());
};
