import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('admin notification and audit RBAC gates', () => {
  it('does not gate notification or audit routes with matter.view', () => {
    const notificationsRoute = read('admin_backend/src/routes/notifications.ts');
    const auditRoute = read('admin_backend/src/routes/audit.ts');

    expect(notificationsRoute).toContain("'notification.view'");
    expect(auditRoute).toContain("'audit.view'");
    expect(notificationsRoute).not.toContain("'matter.view'");
    expect(auditRoute).not.toContain("'matter.view'");
  });

  it('requires recipient ownership or notification.manage for notification mutation', () => {
    const service = read('admin_backend/src/modules/notifications/service.ts');

    expect(service).toContain('recipient_user_id AS recipientUserId');
    expect(service).toContain('actor.permissionCodes.includes');
    expect(service).toContain("'notification.manage'");
    expect(service).toContain('notification_recipient_forbidden');
  });

  it('seeds required notification and audit permissions', () => {
    const referenceData = read('backend/src/modules/platform/referenceData.ts');
    const migrations = read('backend/src/lib/schemaMigrations.ts');

    for (const permission of ['notification.view', 'notification.manage', 'audit.view']) {
      expect(referenceData).toContain(permission);
      expect(migrations).toContain(permission);
    }
  });
});
