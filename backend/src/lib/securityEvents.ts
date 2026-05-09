import type { PoolConnection } from 'mysql2/promise';
import { createPublicId } from './ids.js';
import { getMysqlPool } from './mysql.js';
import { getRequestContext, logEvent } from './observability.js';

type SecurityEventExecutor = Pick<PoolConnection, 'execute'>;

export const recordSecurityEvent = async (
  input: {
    eventTypeCode: string;
    identifierValue?: string | null;
    ipAddress?: string | null;
    success: boolean;
    userAgent?: string | null;
    userId?: number | null;
  },
  executor: SecurityEventExecutor = getMysqlPool()
) => {
  const context = getRequestContext();

  await executor.execute(
    `INSERT INTO security_events (
       public_id,
       user_id,
       identifier_value,
       event_type_code,
       success_flag,
       ip_address,
       user_agent,
       occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
    [
      createPublicId(),
      input.userId ?? null,
      input.identifierValue ?? null,
      input.eventTypeCode,
      input.success ? 1 : 0,
      input.ipAddress ?? context?.ipAddress ?? null,
      input.userAgent ?? context?.userAgent ?? null,
    ]
  );
};

export const recordSecurityEventSafely = (
  input: Parameters<typeof recordSecurityEvent>[0],
  executor?: SecurityEventExecutor
) => {
  void recordSecurityEvent(input, executor).catch((error: unknown) => {
    const context = getRequestContext();
    const safeError = error as { code?: unknown; message?: unknown; name?: unknown };

    logEvent('warn', 'security_event.record_failed', {
      errorCode: typeof safeError.code === 'string' ? safeError.code : undefined,
      errorMessage:
        typeof safeError.message === 'string'
          ? safeError.message.slice(0, 240)
          : 'Unable to record security event.',
      errorName: typeof safeError.name === 'string' ? safeError.name : undefined,
      eventTypeCode: input.eventTypeCode,
      requestId: context?.requestId,
    });
  });
};
