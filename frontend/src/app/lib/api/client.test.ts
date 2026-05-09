import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, createIdempotencyIdentity } from './client';

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('client API networking', () => {
  it('normalizes fetch failures into friendly network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/api/test')).rejects.toMatchObject({
      code: 'network_error',
      message: 'We could not reach the server. Please check your connection and try again.',
    });
  });

  it('times out slow requests with a friendly timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
      )
    );

    const request = apiRequest('/api/slow', { timeoutMs: 5 });
    const assertion = expect(request).rejects.toMatchObject({
      code: 'request_timeout',
      message: 'The request took too long. Please try again.',
    });
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it('reuses a persisted idempotency key after a lost response', async () => {
    const observedKeys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        observedKeys.push(new Headers(init?.headers).get('Idempotency-Key') || '');

        if (observedKeys.length === 1) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }

        return Promise.resolve(
          new Response(JSON.stringify({ status: 'verified' }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          })
        );
      })
    );

    const request = () =>
      apiRequest('/api/v1/me/invoices/inv_1/payment-verify', {
        body: JSON.stringify({ razorpay_payment_id: 'pay_1' }),
        headers: { 'content-type': 'application/json' },
        idempotency: {
          identity: createIdempotencyIdentity('invoice-payment-verify', ['inv_1', 'pay_1']),
          ttlMs: 60_000,
        },
        method: 'POST',
      });

    await expect(request()).rejects.toMatchObject({ code: 'network_error' });
    await expect(request()).resolves.toMatchObject({ status: 'verified' });

    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[0]).toBeTruthy();
    expect(observedKeys[1]).toBe(observedKeys[0]);
  });

  it('clears persisted idempotency keys after successful responses', async () => {
    const observedKeys: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        observedKeys.push(new Headers(init?.headers).get('Idempotency-Key') || '');

        return Promise.resolve(
          new Response(JSON.stringify({ status: 'created' }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          })
        );
      })
    );

    const idempotency = {
      identity: createIdempotencyIdentity('request-submit', ['request-payload-hash']),
      ttlMs: 60_000,
    };

    await apiRequest('/api/v1/dashboard/requests', {
      body: JSON.stringify({ legalDomain: 'immigration' }),
      headers: { 'content-type': 'application/json' },
      idempotency,
      method: 'POST',
    });
    await apiRequest('/api/v1/dashboard/requests', {
      body: JSON.stringify({ legalDomain: 'immigration' }),
      headers: { 'content-type': 'application/json' },
      idempotency,
      method: 'POST',
    });

    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[0]).toBeTruthy();
    expect(observedKeys[1]).toBeTruthy();
    expect(observedKeys[1]).not.toBe(observedKeys[0]);
  });

  it('creates different operation identities for different invoice payments', () => {
    expect(createIdempotencyIdentity('invoice-payment-verify', ['inv_1', 'pay_1'])).not.toBe(
      createIdempotencyIdentity('invoice-payment-verify', ['inv_2', 'pay_1'])
    );
    expect(createIdempotencyIdentity('invoice-payment-verify', ['inv_1', 'pay_1'])).not.toBe(
      createIdempotencyIdentity('invoice-payment-verify', ['inv_1', 'pay_2'])
    );
  });
});
