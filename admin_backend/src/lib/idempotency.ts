import crypto from 'node:crypto';
import type { Request } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { AppError, badRequest } from './httpErrors.js';
import { getMysqlPool } from './mysql.js';

const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const MAX_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 100;
const MAX_RESERVATION_RETRIES = 4;

type IdempotencyRow = RowDataPacket & {
  lockExpired: 0 | 1;
  request_fingerprint_hash: string;
  response_body_json: unknown;
  response_status_code: number | null;
  status_code: string;
};

type IdempotentJsonResult<TBody> = {
  body: TBody;
  replayed: boolean;
  statusCode: number;
};

type IdempotentOperationOptions<TBody> = {
  actorKey?: string | null;
  actorUserId?: number | null;
  body: unknown;
  idempotencyKey?: string | null;
  method: string;
  operation: () => Promise<TBody>;
  path: string;
  scope: string;
  statusCode?: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const isTransientLockError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(String((error as { code?: unknown }).code))
  );

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

const parseStoredJson = <TBody>(value: unknown): TBody => {
  if (typeof value === 'string') {
    return JSON.parse(value) as TBody;
  }

  return value as TBody;
};

export const getIdempotencyKey = (request: Request) => {
  const headerValue = request.header(IDEMPOTENCY_HEADER);

  if (!headerValue) {
    return null;
  }

  const value = headerValue.trim();

  if (value.length < 8 || value.length > 180 || !/^[\x21-\x7E]+$/.test(value)) {
    throw badRequest(
      'invalid_idempotency_key',
      'Idempotency-Key must be 8-180 printable ASCII characters.'
    );
  }

  return value;
};

const getReplayFromRow = <TBody>(row: IdempotencyRow): IdempotentJsonResult<TBody> => {
  if (!row.response_status_code) {
    throw new AppError(
      409,
      'idempotency_request_in_progress',
      'A request with this Idempotency-Key is still being processed.'
    );
  }

  return {
    body: parseStoredJson<TBody>(row.response_body_json),
    replayed: true,
    statusCode: row.response_status_code,
  };
};

const waitForReplay = async <TBody>(
  scope: string,
  idempotencyKeyHash: string,
  requestFingerprintHash: string
): Promise<IdempotentJsonResult<TBody>> => {
  const deadline = Date.now() + MAX_WAIT_MS;
  const pool = getMysqlPool();

  while (Date.now() < deadline) {
    const [rows] = await pool.query<IdempotencyRow[]>(
      `SELECT
         status_code,
         request_fingerprint_hash,
         response_status_code,
         response_body_json,
         CASE
           WHEN locked_until IS NULL OR locked_until <= UTC_TIMESTAMP(6) THEN 1
           ELSE 0
         END AS lockExpired
       FROM idempotency_keys
       WHERE scope_code = ? AND idempotency_key_hash = ?
       LIMIT 1`,
      [scope, idempotencyKeyHash]
    );

    const row = rows[0];

    if (!row) {
      break;
    }

    if (row.request_fingerprint_hash !== requestFingerprintHash) {
      throw new AppError(
        409,
        'idempotency_key_conflict',
        'This Idempotency-Key was already used with a different request payload.'
      );
    }

    if (row.status_code === 'completed') {
      return getReplayFromRow<TBody>(row);
    }

    if (row.status_code === 'failed') {
      throw new AppError(
        409,
        'idempotency_request_failed',
        'The original request for this Idempotency-Key failed and was not replayed.'
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new AppError(
    409,
    'idempotency_request_in_progress',
    'A request with this Idempotency-Key is still being processed.'
  );
};

const reserveOrReplayOnce = async <TBody>(
  options: Omit<IdempotentOperationOptions<TBody>, 'operation' | 'statusCode'> & {
    actorKeyHash: string | null;
    idempotencyKeyHash: string;
    requestFingerprintHash: string;
  }
): Promise<IdempotentJsonResult<TBody> | null> => {
  const connection = await getMysqlPool().getConnection();
  let transactionOpen = false;

  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [insertResult] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO idempotency_keys (
         scope_code,
         idempotency_key_hash,
         actor_key_hash,
         actor_user_id,
         request_method,
         request_path,
         request_fingerprint_hash,
         status_code,
         locked_until,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 SECOND), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        options.scope,
        options.idempotencyKeyHash,
        options.actorKeyHash,
        options.actorUserId ?? null,
        options.method.toUpperCase(),
        options.path.slice(0, 255),
        options.requestFingerprintHash,
      ]
    );

    const isNewReservation = insertResult.affectedRows === 1;
    const [rows] = await connection.query<IdempotencyRow[]>(
      `SELECT
         status_code,
         request_fingerprint_hash,
         response_status_code,
         response_body_json,
         CASE
           WHEN locked_until IS NULL OR locked_until <= UTC_TIMESTAMP(6) THEN 1
           ELSE 0
         END AS lockExpired
       FROM idempotency_keys
       WHERE scope_code = ? AND idempotency_key_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [options.scope, options.idempotencyKeyHash]
    );

    const row = rows[0];

    if (!row) {
      throw new AppError(500, 'idempotency_reservation_missing', 'Idempotency reservation failed.');
    }

    if (row.request_fingerprint_hash !== options.requestFingerprintHash) {
      throw new AppError(
        409,
        'idempotency_key_conflict',
        'This Idempotency-Key was already used with a different request payload.'
      );
    }

    if (isNewReservation) {
      await connection.commit();
      transactionOpen = false;
      return null;
    }

    if (row.status_code === 'completed') {
      const replay = getReplayFromRow<TBody>(row);
      await connection.commit();
      transactionOpen = false;
      return replay;
    }

    if (row.status_code === 'failed') {
      throw new AppError(
        409,
        'idempotency_request_failed',
        'The original request for this Idempotency-Key failed and was not replayed.'
      );
    }

    if (row.status_code === 'processing' && row.lockExpired) {
      const [claimResult] = await connection.execute<ResultSetHeader>(
        `UPDATE idempotency_keys
         SET locked_until = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 SECOND),
             updated_at = UTC_TIMESTAMP(6)
         WHERE scope_code = ?
           AND idempotency_key_hash = ?
           AND status_code = 'processing'
           AND (locked_until IS NULL OR locked_until <= UTC_TIMESTAMP(6))`,
        [options.scope, options.idempotencyKeyHash]
      );

      await connection.commit();
      transactionOpen = false;

      if (claimResult.affectedRows === 1) {
        return null;
      }

      return waitForReplay<TBody>(
        options.scope,
        options.idempotencyKeyHash,
        options.requestFingerprintHash
      );
    }

    await connection.commit();
    transactionOpen = false;
    return waitForReplay<TBody>(
      options.scope,
      options.idempotencyKeyHash,
      options.requestFingerprintHash
    );
  } catch (error) {
    if (transactionOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
};

const reserveOrReplay = async <TBody>(
  options: Omit<IdempotentOperationOptions<TBody>, 'operation' | 'statusCode'> & {
    actorKeyHash: string | null;
    idempotencyKeyHash: string;
    requestFingerprintHash: string;
  }
): Promise<IdempotentJsonResult<TBody> | null> => {
  for (let attempt = 0; attempt <= MAX_RESERVATION_RETRIES; attempt += 1) {
    try {
      return await reserveOrReplayOnce<TBody>(options);
    } catch (error) {
      if (!isTransientLockError(error) || attempt === MAX_RESERVATION_RETRIES) {
        throw error;
      }

      await delay(50 * (attempt + 1));
    }
  }

  throw new AppError(500, 'idempotency_reservation_failed', 'Idempotency reservation failed.');
};

const completeReservation = async <TBody>(
  scope: string,
  idempotencyKeyHash: string,
  statusCode: number,
  body: TBody
) => {
  await getMysqlPool().execute(
    `UPDATE idempotency_keys
     SET status_code = 'completed',
         response_status_code = ?,
         response_body_json = ?,
         locked_until = NULL,
         updated_at = UTC_TIMESTAMP(6)
     WHERE scope_code = ? AND idempotency_key_hash = ? AND status_code = 'processing'`,
    [statusCode, JSON.stringify(body), scope, idempotencyKeyHash]
  );
};

const markReservationFailed = async (scope: string, idempotencyKeyHash: string) => {
  await getMysqlPool().execute(
    `UPDATE idempotency_keys
     SET status_code = 'failed',
         locked_until = NULL,
         updated_at = UTC_TIMESTAMP(6)
     WHERE scope_code = ? AND idempotency_key_hash = ? AND status_code = 'processing'`,
    [scope, idempotencyKeyHash]
  );
};

export const runIdempotentOperation = async <TBody>(
  options: IdempotentOperationOptions<TBody>
): Promise<IdempotentJsonResult<TBody>> => {
  if (!options.idempotencyKey) {
    return {
      body: await options.operation(),
      replayed: false,
      statusCode: options.statusCode ?? 200,
    };
  }

  const actorKey = options.actorKey ?? 'anonymous';
  const actorKeyHash = hash(actorKey);
  const idempotencyKeyHash = hash(`${actorKey}:${options.idempotencyKey}`);
  const requestFingerprintHash = hash(
    stableStringify({
      body: options.body,
      method: options.method.toUpperCase(),
      path: options.path,
      scope: options.scope,
    })
  );

  const replay = await reserveOrReplay<TBody>({
    ...options,
    actorKeyHash,
    idempotencyKeyHash,
    requestFingerprintHash,
  });

  if (replay) {
    return replay;
  }

  try {
    const body = await options.operation();
    const statusCode = options.statusCode ?? 200;
    await completeReservation(options.scope, idempotencyKeyHash, statusCode, body);

    return {
      body,
      replayed: false,
      statusCode,
    };
  } catch (error) {
    await markReservationFailed(options.scope, idempotencyKeyHash);
    throw error;
  }
};

export const runIdempotentJson = async <TBody>(
  request: Request,
  options: Omit<
    IdempotentOperationOptions<TBody>,
    'body' | 'idempotencyKey' | 'method' | 'path'
  > & {
    body?: unknown;
  }
) =>
  runIdempotentOperation<TBody>({
    ...options,
    body: options.body ?? request.body,
    idempotencyKey: getIdempotencyKey(request),
    method: request.method,
    path: request.originalUrl,
  });
