import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

const loadProviderHttp = async () => {
  vi.resetModules();
  process.env.APP_ENV = 'development';
  process.env.AUTH_SESSION_SECRET = 'test-auth-session-secret-with-enough-length';
  process.env.LOG_LEVEL = 'error';

  return import('../../backend/src/lib/providerHttp.js');
};

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('provider HTTP helper', () => {
  it('aborts provider requests when the timeout elapses', async () => {
    vi.useFakeTimers();
    const { providerFetch } = await loadProviderHttp();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    );

    const request = providerFetch('https://provider.example/slow', {
      fetchImpl,
      operation: 'timeout_test',
      providerCode: 'test-provider',
      timeoutMs: 5,
    });
    const assertion = expect(request).rejects.toMatchObject({ code: 'provider_http_timeout' });

    await vi.advanceTimersByTimeAsync(6);

    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries transient responses only when the operation is marked safe to retry', async () => {
    const { providerFetch } = await loadProviderHttp();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const response = await providerFetch('https://provider.example/rates', {
      fetchImpl,
      operation: 'safe_get',
      providerCode: 'test-provider',
      retries: 1,
      retryDelayMs: 0,
      safeToRetry: true,
      timeoutMs: 50,
    });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry send/payment-style operations unless explicitly marked safe', async () => {
    const { providerFetch } = await loadProviderHttp();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));

    const response = await providerFetch('https://provider.example/send', {
      fetchImpl,
      method: 'POST',
      operation: 'unsafe_send',
      providerCode: 'test-provider',
      retries: 3,
      retryDelayMs: 0,
      safeToRetry: false,
      timeoutMs: 50,
    });

    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
