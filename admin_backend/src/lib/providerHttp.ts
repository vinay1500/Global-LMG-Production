import { env } from '../config/env.js';
import { logEvent } from './observability.js';

type ProviderFetchInput = string | URL | Request;

type ProviderFetchOptions = RequestInit & {
  fetchImpl?: typeof fetch;
  operation: string;
  providerCode: string;
  retries?: number;
  retryDelayMs?: number;
  retryOnStatuses?: number[];
  safeToRetry?: boolean;
  timeoutMs?: number;
};

export class ProviderHttpError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.code = code;
  }
}

const DEFAULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const getHost = (input: ProviderFetchInput) => {
  const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;

  try {
    return new URL(url).host;
  } catch {
    return 'unknown';
  }
};

const delay = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

const isRetryableStatus = (status: number, retryOnStatuses?: number[]) =>
  retryOnStatuses ? retryOnStatuses.includes(status) : DEFAULT_RETRY_STATUSES.has(status);

export const providerFetch = async (
  input: ProviderFetchInput,
  options: ProviderFetchOptions
) => {
  const {
    fetchImpl = fetch,
    operation,
    providerCode,
    retries = options.safeToRetry ? 2 : 0,
    retryDelayMs = 250,
    retryOnStatuses,
    safeToRetry = false,
    timeoutMs = env.PROVIDER_HTTP_TIMEOUT_MS,
    ...init
  } = options;
  const maxAttempts = Math.max(1, (safeToRetry ? retries : 0) + 1);
  const host = getHost(input);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });

      if (
        safeToRetry &&
        attempt < maxAttempts &&
        isRetryableStatus(response.status, retryOnStatuses)
      ) {
        logEvent('warn', 'provider.http_retry', {
          attempt,
          host,
          operation,
          providerCode,
          statusCode: response.status,
        });
        await delay(retryDelayMs);
        continue;
      }

      return response;
    } catch (error) {
      const timedOut = controller.signal.aborted || isAbortError(error);
      const canRetry = safeToRetry && attempt < maxAttempts;

      logEvent(timedOut || !canRetry ? 'warn' : 'info', canRetry ? 'provider.http_retry' : 'provider.http_failed', {
        attempt,
        errorCode: timedOut ? 'timeout' : error instanceof Error ? error.name : 'unknown',
        host,
        operation,
        providerCode,
        timeoutMs,
      });

      if (canRetry) {
        await delay(retryDelayMs);
        continue;
      }

      if (timedOut) {
        throw new ProviderHttpError(
          'provider_http_timeout',
          `${providerCode} request timed out.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ProviderHttpError('provider_http_failed', `${providerCode} request failed.`);
};
