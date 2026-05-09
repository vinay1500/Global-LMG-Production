import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, createIdempotencyIdentity } from './client';

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('admin API networking', () => {
  it('normalizes fetch failures into friendly network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/api/admin/test')).rejects.toMatchObject({
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

    const request = apiRequest('/api/admin/slow', { timeoutMs: 5 });
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
          new Response(JSON.stringify({ status: 'created' }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          })
        );
      })
    );

    const request = () =>
      apiRequest('/api/v1/admin/billing/payments', {
        body: JSON.stringify({ amount: 100, invoiceId: 'inv_1' }),
        headers: { 'content-type': 'application/json' },
        idempotency: {
          identity: createIdempotencyIdentity('admin-manual-payment', ['inv_1', 100, '2026-05-09']),
          ttlMs: 60_000,
        },
        method: 'POST',
      });

    await expect(request()).rejects.toMatchObject({ code: 'network_error' });
    await expect(request()).resolves.toMatchObject({ status: 'created' });

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
      identity: createIdempotencyIdentity('admin-refund-create', ['pay_1', 'inv_1', 25]),
      ttlMs: 60_000,
    };

    await apiRequest('/api/v1/admin/billing/refunds', {
      body: JSON.stringify({ amount: 25, paymentId: 'pay_1' }),
      headers: { 'content-type': 'application/json' },
      idempotency,
      method: 'POST',
    });
    await apiRequest('/api/v1/admin/billing/refunds', {
      body: JSON.stringify({ amount: 25, paymentId: 'pay_1' }),
      headers: { 'content-type': 'application/json' },
      idempotency,
      method: 'POST',
    });

    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[0]).toBeTruthy();
    expect(observedKeys[1]).toBeTruthy();
    expect(observedKeys[1]).not.toBe(observedKeys[0]);
  });

  it('creates different operation identities for different manual payments', () => {
    expect(createIdempotencyIdentity('admin-manual-payment', ['inv_1', 100, '2026-05-09'])).not.toBe(
      createIdempotencyIdentity('admin-manual-payment', ['inv_2', 100, '2026-05-09'])
    );
    expect(createIdempotencyIdentity('admin-manual-payment', ['inv_1', 100, '2026-05-09'])).not.toBe(
      createIdempotencyIdentity('admin-manual-payment', ['inv_1', 200, '2026-05-09'])
    );
  });
});
