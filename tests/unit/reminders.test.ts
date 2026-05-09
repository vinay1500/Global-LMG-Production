import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'admin_backend/src/modules/reminders/service.ts'),
  'utf8'
);

const extractBlock = (start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

describe('reminder retry accounting', () => {
  it('locks due reminders without incrementing retry_count', () => {
    const lockBlock = extractBlock('const lockDueReminders', 'export const listReminderWorkspace');

    expect(lockBlock).toContain("delivery_status_code = 'processing'");
    expect(lockBlock).toContain('locked_at = UTC_TIMESTAMP(6)');
    expect(lockBlock).toContain('locked_by = ?');
    expect(lockBlock).toContain('next_attempt_at = NULL');
    expect(lockBlock).not.toMatch(/retry_count\s*=\s*retry_count\s*\+\s*1/);
  });

  it('increments retry_count only when a reminder is marked failed', () => {
    const retryIncrementMatches = source.match(/retry_count\s*=\s*retry_count\s*\+\s*1/g) || [];
    const failureBlock = extractBlock(
      'const markReminderFailedInCurrentTransaction',
      'const lockDueReminders'
    );

    expect(retryIncrementMatches).toHaveLength(1);
    expect(failureBlock).toMatch(/retry_count\s*=\s*retry_count\s*\+\s*1/);
    expect(failureBlock).toMatch(/WHEN retry_count \+ 1 < max_attempts/);
  });

  it('keeps successful first-attempt processing from changing retry_count', () => {
    const completeBlock = extractBlock(
      'const completeLockedReminder',
      'const markReminderFailedInCurrentTransaction'
    );
    const sentUpdateStart = completeBlock.indexOf("SET delivery_status_code = 'sent'");
    const sentUpdateEnd = completeBlock.indexOf('await auditReminder', sentUpdateStart);

    expect(sentUpdateStart).toBeGreaterThanOrEqual(0);
    expect(sentUpdateEnd).toBeGreaterThan(sentUpdateStart);

    const sentUpdateBlock = completeBlock.slice(sentUpdateStart, sentUpdateEnd);
    expect(sentUpdateBlock).not.toMatch(/retry_count\s*=/);
  });

  it('caps one cron processing batch at 250 reminders', () => {
    expect(source).toContain('const MAX_PROCESS_BATCH_SIZE = 250');
    expect(source).toContain('env.REMINDER_PROCESS_BATCH_SIZE, MAX_PROCESS_BATCH_SIZE');
  });
});
