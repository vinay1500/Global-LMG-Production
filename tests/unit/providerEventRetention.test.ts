import { describe, expect, it } from 'vitest';
import {
  buildNotificationRetentionJob,
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_RETENTION_ONLY_DISMISSED,
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

  it('deletes only old dismissed notifications by default', () => {
    expect(NOTIFICATION_RETENTION_DAYS).toBe(180);
    expect(NOTIFICATION_RETENTION_ONLY_DISMISSED).toBe(true);

    const notificationJob = retentionJobs.find((job) => job.label === 'notifications_dismissed');

    expect(notificationJob).toBeDefined();
    expect(notificationJob?.sql).toContain('DELETE FROM notifications');
    expect(notificationJob?.sql).toContain('dismissed_at IS NOT NULL');
    expect(notificationJob?.sql).toContain('dismissed_at < DATE_SUB');
    expect(notificationJob?.sql).not.toContain('read_at IS NOT NULL');
    expect(notificationJob?.values).toEqual([180]);
  });

  it('can be configured to include read notifications without deleting unread rows', () => {
    const notificationJob = buildNotificationRetentionJob(365, false);

    expect(notificationJob.label).toBe('notifications_read_or_dismissed');
    expect(notificationJob.sql).toContain('DELETE FROM notifications');
    expect(notificationJob.sql).toContain('dismissed_at IS NOT NULL OR is_read = 1 OR read_at IS NOT NULL');
    expect(notificationJob.sql).toContain('COALESCE(dismissed_at, read_at, created_at)');
    expect(notificationJob.sql).not.toContain('OR created_at');
    expect(notificationJob.values).toEqual([365]);
  });
});
