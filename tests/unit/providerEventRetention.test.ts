import { describe, expect, it } from 'vitest';
import {
  PROVIDER_EVENT_RETENTION_DAYS,
  retentionJobs,
} from '../../backend/src/scripts/cleanupRetention.js';

describe('provider event retention cleanup', () => {
  it('deletes email and SMS provider events after ninety days', () => {
    expect(PROVIDER_EVENT_RETENTION_DAYS).toBe(90);

    const emailJob = retentionJobs.find((job) => job.label === 'email_events');
    const smsJob = retentionJobs.find((job) => job.label === 'sms_events');

    expect(emailJob).toBeDefined();
    expect(emailJob?.sql).toContain('DELETE FROM email_events');
    expect(emailJob?.sql).toContain('created_at < DATE_SUB');
    expect(emailJob?.values).toEqual([90]);

    expect(smsJob).toBeDefined();
    expect(smsJob?.sql).toContain('DELETE FROM sms_events');
    expect(smsJob?.sql).toContain('created_at < DATE_SUB');
    expect(smsJob?.values).toEqual([90]);
  });
});
