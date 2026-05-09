import type { Request } from 'express';
import { forbidden, tooManyRequests } from './httpErrors.js';
import { getRequestIpAddress } from './requestSecurity.js';
import { consumePersistentRateLimit } from '../modules/auth/persistentRateLimiter.js';

const WEBHOOK_RATE_LIMIT_MAX_ATTEMPTS = 300;
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const WEBHOOK_RATE_LIMIT_LOCK_MS = 5 * 60_000;

const parseIpv4 = (value: string) => {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    result = (result << 8) + octet;
  }

  return result >>> 0;
};

const ipv4CidrContains = (ipAddress: string, cidr: string) => {
  const [range, prefixRaw] = cidr.split('/');
  const ip = parseIpv4(ipAddress);
  const base = parseIpv4(range || '');
  const prefix = Number(prefixRaw);

  if (ip === null || base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (base & mask);
};

export const parseWebhookIpAllowlist = (value: string | undefined) =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export const isWebhookIpAllowed = (ipAddress: string, allowlist: string | undefined) => {
  const entries = parseWebhookIpAllowlist(allowlist);

  if (entries.length === 0) {
    return true;
  }

  return entries.some((entry) =>
    entry.includes('/') ? ipv4CidrContains(ipAddress, entry) : entry === ipAddress
  );
};

export const assertWebhookIpAllowed = (
  request: Request,
  providerCode: string,
  allowlist: string | undefined
) => {
  const ipAddress = getRequestIpAddress(request);

  if (!isWebhookIpAllowed(ipAddress, allowlist)) {
    throw forbidden(
      'webhook_ip_not_allowed',
      `${providerCode} webhook source is not allowed.`
    );
  }
};

export const assertWebhookRateLimitAllowed = (
  result: { allowed: boolean; retryAfterSeconds: number }
) => {
  if (!result.allowed) {
    throw tooManyRequests(
      'webhook_rate_limited',
      'Too many webhook requests from this source.',
      { retryAfterSeconds: result.retryAfterSeconds }
    );
  }
};

export const consumeWebhookRateLimit = async (request: Request, providerCode: string) => {
  const ipAddress = getRequestIpAddress(request);
  const result = await consumePersistentRateLimit({
    key: `${providerCode}:webhook:ip:${ipAddress}`,
    lockMs: WEBHOOK_RATE_LIMIT_LOCK_MS,
    maxAttempts: WEBHOOK_RATE_LIMIT_MAX_ATTEMPTS,
    scope: 'provider_webhook',
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
  });

  assertWebhookRateLimitAllowed(result);
};

export const assertWebhookRequestAllowed = async (
  request: Request,
  providerCode: string,
  allowlist: string | undefined
) => {
  assertWebhookIpAllowed(request, providerCode, allowlist);
  await consumeWebhookRateLimit(request, providerCode);
};
