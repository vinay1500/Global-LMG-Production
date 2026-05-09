import type { ApiErrorResponse } from './contracts';

const DEFAULT_HEADERS = {
  Accept: 'application/json',
};

const CSRF_COOKIE_NAME = 'global_lmg_csrf';
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_API_DOWNLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_PERSISTENT_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
const IDEMPOTENCY_STORAGE_PREFIX = 'global_lmg_idempotency:v1:';
const inFlightIdempotencyKeys = new Map<string, string>();

export type ApiRequestOptions = RequestInit & {
  idempotency?: {
    clearOnSuccess?: boolean;
    identity: string;
    ttlMs?: number;
  };
  timeoutMs?: number | null;
};

export class ApiRequestError extends Error {
  public readonly code: string;
  public readonly issues?: unknown;
  public readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    options: {
      issues?: unknown;
      retryAfterSeconds?: number;
    } = {}
  ) {
    super(message);
    this.code = code;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const readCookie = (name: string) => {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
};

const createIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const hashIdempotencyPart = (value: string) => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
};

export const createIdempotencyIdentity = (
  scope: string,
  parts: Array<boolean | number | string | null | undefined>
) =>
  `${scope}:${parts
    .map((part) => hashIdempotencyPart(String(part ?? '')))
    .join('.')}`;

const getBodyFingerprint = (body: BodyInit | null | undefined) => {
  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return '';
};

const getIdempotencyStorage = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const getIdempotencyStorageKey = (identity: string) =>
  `${IDEMPOTENCY_STORAGE_PREFIX}${identity}`;

const readPersistentIdempotencyKey = (identity: string) => {
  const storage = getIdempotencyStorage();

  if (!storage) {
    return undefined;
  }

  const storageKey = getIdempotencyStorageKey(identity);

  try {
    const entry = JSON.parse(storage.getItem(storageKey) || 'null') as
      | { expiresAt?: number; key?: string }
      | null;

    if (!entry?.key || !entry.expiresAt || entry.expiresAt <= Date.now()) {
      storage.removeItem(storageKey);
      return undefined;
    }

    return entry.key;
  } catch {
    storage.removeItem(storageKey);
    return undefined;
  }
};

const writePersistentIdempotencyKey = (identity: string, key: string, ttlMs: number) => {
  const storage = getIdempotencyStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getIdempotencyStorageKey(identity),
      JSON.stringify({
        createdAt: Date.now(),
        expiresAt: Date.now() + ttlMs,
        key,
      })
    );
  } catch {
    // Storage quota/private-mode failures should not block the protected mutation.
  }
};

export const clearPersistentIdempotencyKey = (identity: string) => {
  const storage = getIdempotencyStorage();

  if (!storage) {
    return;
  }

  try {
    storage.removeItem(getIdempotencyStorageKey(identity));
  } catch {
    // Nothing actionable for the UI; TTL still bounds stale entries.
  }
};

const getOrCreatePersistentIdempotencyKey = (identity: string, ttlMs: number) => {
  const existingKey = readPersistentIdempotencyKey(identity);

  if (existingKey) {
    return existingKey;
  }

  const key = createIdempotencyKey();
  writePersistentIdempotencyKey(identity, key, ttlMs);
  return key;
};

const attachInFlightIdempotencyKey = (
  headers: Headers,
  method: string,
  url: string,
  body: BodyInit | null | undefined
) => {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || headers.has('Idempotency-Key')) {
    return null;
  }

  const fingerprint = `${method} ${url} ${getBodyFingerprint(body)}`;
  const key = inFlightIdempotencyKeys.get(fingerprint) ?? createIdempotencyKey();
  inFlightIdempotencyKeys.set(fingerprint, key);
  headers.set('Idempotency-Key', key);

  return {
    fingerprint,
    key,
  };
};

const attachIdempotencyKey = (
  headers: Headers,
  method: string,
  url: string,
  body: BodyInit | null | undefined,
  persistentIdempotency: ApiRequestOptions['idempotency']
) => {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || headers.has('Idempotency-Key')) {
    return null;
  }

  if (persistentIdempotency?.identity) {
    const key = getOrCreatePersistentIdempotencyKey(
      persistentIdempotency.identity,
      persistentIdempotency.ttlMs ?? DEFAULT_PERSISTENT_IDEMPOTENCY_TTL_MS
    );
    headers.set('Idempotency-Key', key);

    return {
      clearOnSuccess: persistentIdempotency.clearOnSuccess !== false,
      identity: persistentIdempotency.identity,
      persistent: true,
    };
  }

  return attachInFlightIdempotencyKey(headers, method, url, body);
};

const readTimeoutMs = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const API_REQUEST_TIMEOUT_MS = readTimeoutMs(
  import.meta.env.VITE_API_TIMEOUT_MS,
  DEFAULT_API_TIMEOUT_MS
);

export const API_DOWNLOAD_TIMEOUT_MS = readTimeoutMs(
  import.meta.env.VITE_API_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_API_DOWNLOAD_TIMEOUT_MS
);

export const PAYMENT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const FORM_IDEMPOTENCY_TTL_MS = DEFAULT_PERSISTENT_IDEMPOTENCY_TTL_MS;

const isAbortError = (error: unknown) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

export const normalizeFetchError = (error: unknown, timedOut = false) => {
  if (timedOut || isAbortError(error)) {
    return new ApiRequestError(
      'request_timeout',
      'The request took too long. Please try again.'
    );
  }

  return new ApiRequestError(
    'network_error',
    'We could not reach the server. Please check your connection and try again.'
  );
};

export const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number | null = API_REQUEST_TIMEOUT_MS
) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, init);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const callerSignal = init.signal;

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    throw normalizeFetchError(error, timedOut);
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const apiRequest = async <TResponse>(
  url: string,
  init: ApiRequestOptions = {}
): Promise<TResponse> => {
  const {
    idempotency: persistentIdempotency,
    timeoutMs = API_REQUEST_TIMEOUT_MS,
    ...requestInit
  } = init;
  const headers = new Headers({
    ...DEFAULT_HEADERS,
    ...(requestInit.headers || {}),
  });
  const method = requestInit.method?.toUpperCase() || 'GET';
  const idempotency = attachIdempotencyKey(
    headers,
    method,
    url,
    requestInit.body,
    persistentIdempotency
  );

  if (method !== 'GET' && method !== 'HEAD' && !headers.has('x-csrf-token')) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }
  }

  let response: Response;

  try {
    response = await fetchWithTimeout(url, {
      credentials: 'include',
      ...requestInit,
      headers,
    }, timeoutMs);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw error;
    }
    throw normalizeFetchError(error);
  } finally {
    if (
      idempotency &&
      'fingerprint' in idempotency &&
      inFlightIdempotencyKeys.get(idempotency.fingerprint) === idempotency.key
    ) {
      inFlightIdempotencyKeys.delete(idempotency.fingerprint);
    }
  }

  if (!response.ok) {
    let errorBody: ApiErrorResponse | undefined;

    try {
      errorBody = (await response.json()) as ApiErrorResponse;
    } catch {
      errorBody = undefined;
    }

    throw new ApiRequestError(
      errorBody?.error || 'api_request_failed',
      errorBody?.message || `API request failed with status ${response.status}`,
      {
        issues: errorBody?.issues,
        retryAfterSeconds: errorBody?.retryAfterSeconds,
      }
    );
  }

  if (response.status === 204) {
    if (idempotency && 'persistent' in idempotency && idempotency.clearOnSuccess) {
      clearPersistentIdempotencyKey(idempotency.identity);
    }

    return undefined as TResponse;
  }

  const responseBody = (await response.json()) as TResponse;

  if (idempotency && 'persistent' in idempotency && idempotency.clearOnSuccess) {
    clearPersistentIdempotencyKey(idempotency.identity);
  }

  return responseBody;
};
