import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminActor } from '../../admin_backend/src/modules/auth/service.js';
import type * as SharedModule from '../../admin_backend/src/modules/shared.js';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const actor = (roleCodes: string[], permissionCodes: string[] = []): AdminActor => ({
  displayName: 'Launch Gate User',
  email: 'launch-gate@example.local',
  id: 'user_public_id',
  mustRotatePassword: false,
  permissionCodes,
  roleCodes,
  userId: 42,
});

let shared: typeof SharedModule;

describe('admin launch blocker regressions', () => {
  beforeAll(async () => {
    process.env.AUTH_SESSION_SECRET ||= 'unit-admin-launch-blocker-secret-1234567890';
    shared = await import('../../admin_backend/src/modules/shared.js');
  });

  it('treats assignment-scoped personas as non-financial and non-internal response viewers', () => {
    expect(shared.getAdminResponseVisibility(actor(['ops_admin']))).toMatchObject({
      allowFinancial: true,
      allowInternal: true,
      isAssignedOnly: false,
    });
    expect(shared.getAdminResponseVisibility(actor(['case_staff']))).toMatchObject({
      allowFinancial: false,
      allowInternal: false,
      isAssignedOnly: true,
    });
    expect(shared.getAdminResponseVisibility(actor(['advocate']))).toMatchObject({
      allowFinancial: false,
      allowInternal: false,
      isAssignedOnly: true,
    });
  });

  it('enforces account status and operational profile validity in admin auth resolution', () => {
    const authService = read('admin_backend/src/modules/auth/service.ts');

    expect(authService).toContain("first.account_status_code !== 'active'");
    expect(authService).toContain('ADMIN_OPERATIONAL_PROFILE_GUARD_SQL');
    expect(authService).toContain("u.account_status_code = 'active'");
    expect(authService).toContain("staff_guard_ur.role_code IN ('case_staff', 'field_staff', 'internal_staff')");
    expect(authService).toContain("staff_guard_sp.employment_status_code = 'active'");
    expect(authService).toContain("advocate_guard_ur.role_code = 'advocate'");
    expect(authService).toContain("advocate_guard_cpu.relationship_status_code = 'active'");
    expect(authService).toContain("advocate_guard_cp.partner_status_code = 'active'");
  });

  it('provides a safe stale-session cleanup helper for disabled or invalid admin users', () => {
    const authService = read('admin_backend/src/modules/auth/service.ts');
    const cleanupScript = read('admin_backend/src/scripts/revokeUnsafeAdminSessions.ts');

    expect(authService).toContain('export const revokeUnsafeAdminSessions');
    expect(authService).toContain('UPDATE user_sessions us');
    expect(authService).toContain('u.login_enabled = 0');
    expect(authService).toContain("u.account_status_code <> 'active'");
    expect(authService).toContain("staff_cleanup_ur.role_code IN ('case_staff', 'field_staff', 'internal_staff')");
    expect(authService).toContain("advocate_cleanup_ur.role_code = 'advocate'");
    expect(cleanupScript).toContain('revokeUnsafeAdminSessions');
  });
});
