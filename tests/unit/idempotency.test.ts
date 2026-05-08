import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

type IdempotencyModule = typeof import('../../backend/src/lib/idempotency.js');
type TargetName = 'admin' | 'backend';

type StoredIdempotencyRow = {
  actorKeyHash: string | null;
  actorUserId: number | null;
  createdAtMs: number;
  idempotencyKeyHash: string;
  lockedUntilMs: number | null;
  requestFingerprintHash: string;
  requestMethod: string;
  requestPath: string;
  responseBodyJson: string | null;
  responseStatusCode: number | null;
  scope: string;
  statusCode: 'completed' | 'failed' | 'processing';
  updatedAtMs: number;
};

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const normalizeForFingerprint = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeForFingerprint);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [entryKey, normalizeForFingerprint(entryValue)])
    );
  }

  return value ?? null;
};

const stableStringify = (value: unknown) => JSON.stringify(normalizeForFingerprint(value));

const mapKey = (scope: string, idempotencyKeyHash: string) => `${scope}:${idempotencyKeyHash}`;

class FakeIdempotencyPool {
  public readonly rows = new Map<string, StoredIdempotencyRow>();

  public nowMs = Date.parse('2026-05-08T00:00:00.000Z');

  getConnection() {
    return new FakeIdempotencyConnection(this);
  }

  async query(_sql: string, params: unknown[]) {
    const [scope, idempotencyKeyHash] = params as [string, string];
    return [this.selectRows(scope, idempotencyKeyHash)];
  }

  async execute(sql: string, params: unknown[]) {
    return [this.applyExecute(sql, params)];
  }

  seedProcessing(input: {
    actorKey?: string;
    body: unknown;
    idempotencyKey: string;
    lockedUntilMs: number | null;
    method?: string;
    path?: string;
    scope: string;
  }) {
    const actorKey = input.actorKey ?? 'anonymous';
    const idempotencyKeyHash = hash(`${actorKey}:${input.idempotencyKey}`);
    const requestFingerprintHash = hash(
      stableStringify({
        body: input.body,
        method: (input.method ?? 'POST').toUpperCase(),
        path: input.path ?? '/unit/idempotency',
        scope: input.scope,
      })
    );

    this.rows.set(mapKey(input.scope, idempotencyKeyHash), {
      actorKeyHash: hash(actorKey),
      actorUserId: null,
      createdAtMs: this.nowMs - 60_000,
      idempotencyKeyHash,
      lockedUntilMs: input.lockedUntilMs,
      requestFingerprintHash,
      requestMethod: (input.method ?? 'POST').toUpperCase(),
      requestPath: input.path ?? '/unit/idempotency',
      responseBodyJson: null,
      responseStatusCode: null,
      scope: input.scope,
      statusCode: 'processing',
      updatedAtMs: this.nowMs - 60_000,
    });
  }

  private selectRows(scope: string, idempotencyKeyHash: string) {
    const row = this.rows.get(mapKey(scope, idempotencyKeyHash));

    if (!row) {
      return [];
    }

    return [
      {
        lockExpired:
          row.lockedUntilMs === null || row.lockedUntilMs <= this.nowMs ? 1 : 0,
        request_fingerprint_hash: row.requestFingerprintHash,
        response_body_json: row.responseBodyJson,
        response_status_code: row.responseStatusCode,
        status_code: row.statusCode,
      },
    ];
  }

  private applyExecute(sql: string, params: unknown[]) {
    if (sql.includes('INSERT IGNORE INTO idempotency_keys')) {
      const [
        scope,
        idempotencyKeyHash,
        actorKeyHash,
        actorUserId,
        requestMethod,
        requestPath,
        requestFingerprintHash,
      ] = params as [string, string, string | null, number | null, string, string, string];
      const key = mapKey(scope, idempotencyKeyHash);

      if (this.rows.has(key)) {
        return { affectedRows: 0 };
      }

      this.rows.set(key, {
        actorKeyHash,
        actorUserId,
        createdAtMs: this.nowMs,
        idempotencyKeyHash,
        lockedUntilMs: this.nowMs + 30_000,
        requestFingerprintHash,
        requestMethod,
        requestPath,
        responseBodyJson: null,
        responseStatusCode: null,
        scope,
        statusCode: 'processing',
        updatedAtMs: this.nowMs,
      });

      return { affectedRows: 1 };
    }

    if (sql.includes("SET status_code = 'completed'")) {
      const [responseStatusCode, responseBodyJson, scope, idempotencyKeyHash] = params as [
        number,
        string,
        string,
        string,
      ];
      const row = this.rows.get(mapKey(scope, idempotencyKeyHash));

      if (!row || row.statusCode !== 'processing') {
        return { affectedRows: 0 };
      }

      row.statusCode = 'completed';
      row.responseStatusCode = responseStatusCode;
      row.responseBodyJson = responseBodyJson;
      row.lockedUntilMs = null;
      row.updatedAtMs = this.nowMs;
      return { affectedRows: 1 };
    }

    if (sql.includes("SET status_code = 'failed'")) {
      const [scope, idempotencyKeyHash] = params as [string, string];
      const row = this.rows.get(mapKey(scope, idempotencyKeyHash));

      if (!row || row.statusCode !== 'processing') {
        return { affectedRows: 0 };
      }

      row.statusCode = 'failed';
      row.lockedUntilMs = null;
      row.updatedAtMs = this.nowMs;
      return { affectedRows: 1 };
    }

    if (sql.includes('SET locked_until = DATE_ADD')) {
      const [scope, idempotencyKeyHash] = params as [string, string];
      const row = this.rows.get(mapKey(scope, idempotencyKeyHash));

      if (
        !row ||
        row.statusCode !== 'processing' ||
        (row.lockedUntilMs !== null && row.lockedUntilMs > this.nowMs)
      ) {
        return { affectedRows: 0 };
      }

      row.lockedUntilMs = this.nowMs + 30_000;
      row.updatedAtMs = this.nowMs;
      return { affectedRows: 1 };
    }

    throw new Error(`Unexpected idempotency SQL in fake pool: ${sql}`);
  }
}

class FakeIdempotencyConnection {
  constructor(private readonly pool: FakeIdempotencyPool) {}

  async beginTransaction() {
    return undefined;
  }

  async commit() {
    return undefined;
  }

  async rollback() {
    return undefined;
  }

  release() {
    return undefined;
  }

  async query(sql: string, params: unknown[]) {
    return this.pool.query(sql, params);
  }

  async execute(sql: string, params: unknown[]) {
    return this.pool.execute(sql, params);
  }
}

const loadTarget = async (target: TargetName) => {
  vi.resetModules();
  process.env.AUTH_SESSION_SECRET ||= 'test-admin-session-secret-with-enough-length';

  const pool = new FakeIdempotencyPool();

  if (target === 'backend') {
    vi.doMock('../../backend/src/lib/mysql.js', () => ({
      getMysqlPool: () => pool,
    }));

    return {
      module: await import('../../backend/src/lib/idempotency.js'),
      pool,
    };
  }

  vi.doMock('../../admin_backend/src/lib/mysql.js', () => ({
    getMysqlPool: () => pool,
  }));

  return {
    module: (await import('../../admin_backend/src/lib/idempotency.js')) as IdempotencyModule,
    pool,
  };
};

const runOperation = <TBody>(
  module: IdempotencyModule,
  options: {
    actorKey?: string;
    body?: unknown;
    idempotencyKey: string;
    operation: () => Promise<TBody>;
    path?: string;
    scope?: string;
    statusCode?: number;
  }
) =>
  module.runIdempotentOperation({
    actorKey: options.actorKey ?? 'unit-actor',
    body: options.body ?? { amount: 100, invoiceId: 'inv-test' },
    idempotencyKey: options.idempotencyKey,
    method: 'POST',
    operation: options.operation,
    path: options.path ?? '/unit/idempotency',
    scope: options.scope ?? 'unit:idempotency',
    statusCode: options.statusCode ?? 201,
  });

describe.each([
  ['client backend', 'backend'],
  ['admin backend', 'admin'],
] as const)('%s idempotency helper', (_label, target) => {
  it('runs the first operation and persists the response', async () => {
    const { module, pool } = await loadTarget(target);
    let calls = 0;

    const result = await runOperation(module, {
      idempotencyKey: 'idem-first-call',
      operation: async () => {
        calls += 1;
        return { calls, ok: true };
      },
    });

    expect(result).toEqual({
      body: { calls: 1, ok: true },
      replayed: false,
      statusCode: 201,
    });
    expect(calls).toBe(1);
    expect([...pool.rows.values()][0]).toMatchObject({
      responseBodyJson: JSON.stringify({ calls: 1, ok: true }),
      responseStatusCode: 201,
      statusCode: 'completed',
    });
  });

  it('replays the cached body without running the operation again', async () => {
    const { module } = await loadTarget(target);
    let calls = 0;

    const operation = async () => {
      calls += 1;
      return { calls, token: 'stored-response' };
    };

    await runOperation(module, {
      idempotencyKey: 'idem-replay-call',
      operation,
    });
    const replay = await runOperation(module, {
      idempotencyKey: 'idem-replay-call',
      operation,
    });

    expect(calls).toBe(1);
    expect(replay).toEqual({
      body: { calls: 1, token: 'stored-response' },
      replayed: true,
      statusCode: 201,
    });
  });

  it('runs the operation again for a different idempotency key', async () => {
    const { module } = await loadTarget(target);
    let calls = 0;

    const operation = async () => {
      calls += 1;
      return { calls };
    };

    await runOperation(module, { idempotencyKey: 'idem-key-a', operation });
    const result = await runOperation(module, { idempotencyKey: 'idem-key-b', operation });

    expect(calls).toBe(2);
    expect(result.replayed).toBe(false);
    expect(result.body).toEqual({ calls: 2 });
  });

  it('runs the operation again for the same key in a different scope', async () => {
    const { module } = await loadTarget(target);
    let calls = 0;

    const operation = async () => {
      calls += 1;
      return { calls };
    };

    await runOperation(module, {
      idempotencyKey: 'idem-shared-key',
      operation,
      scope: 'unit:scope:a',
    });
    const result = await runOperation(module, {
      idempotencyKey: 'idem-shared-key',
      operation,
      scope: 'unit:scope:b',
    });

    expect(calls).toBe(2);
    expect(result.replayed).toBe(false);
    expect(result.body).toEqual({ calls: 2 });
  });

  it('rejects the same key and scope with a different fingerprint', async () => {
    const { module } = await loadTarget(target);
    let calls = 0;

    const operation = async () => {
      calls += 1;
      return { calls };
    };

    await runOperation(module, {
      body: { amount: 100 },
      idempotencyKey: 'idem-fingerprint-conflict',
      operation,
    });

    await expect(
      runOperation(module, {
        body: { amount: 200 },
        idempotencyKey: 'idem-fingerprint-conflict',
        operation,
      })
    ).rejects.toMatchObject({
      code: 'idempotency_key_conflict',
      statusCode: 409,
    });
    expect(calls).toBe(1);
  });

  it('allows retry and recovery after an expired processing lock', async () => {
    const { module, pool } = await loadTarget(target);
    let calls = 0;

    pool.seedProcessing({
      actorKey: 'unit-actor',
      body: { amount: 100, invoiceId: 'inv-test' },
      idempotencyKey: 'idem-expired-lock',
      lockedUntilMs: pool.nowMs - 1,
      scope: 'unit:idempotency',
    });

    const result = await runOperation(module, {
      idempotencyKey: 'idem-expired-lock',
      operation: async () => {
        calls += 1;
        return { recovered: true };
      },
    });

    expect(calls).toBe(1);
    expect(result).toEqual({
      body: { recovered: true },
      replayed: false,
      statusCode: 201,
    });
    expect([...pool.rows.values()][0]).toMatchObject({
      responseBodyJson: JSON.stringify({ recovered: true }),
      statusCode: 'completed',
    });
  });
});
