import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminActor } from '../../admin_backend/src/modules/auth/service.js';
import type * as ProtectedRolesModule from '../../admin_backend/src/modules/rbac/protectedRoles.js';

let protectedRoles: typeof ProtectedRolesModule;

const actor = (roleCodes: string[]): AdminActor => ({
  displayName: 'RBAC User',
  email: 'rbac@example.local',
  id: 'user_public_id',
  mustRotatePassword: false,
  permissionCodes: ['rbac.manage'],
  roleCodes,
  userId: 123,
});

describe('protected admin role assignment guard', () => {
  beforeAll(async () => {
    process.env.AUTH_SESSION_SECRET ||= 'unit-test-admin-protected-roles-secret-1234567890';
    protectedRoles = await import('../../admin_backend/src/modules/rbac/protectedRoles.js');
  });

  it('allows ops_admin to assign the explicitly allowed ops_admin protected role', () => {
    expect(protectedRoles.isProtectedRoleCode('ops_admin')).toBe(true);
    expect(protectedRoles.canAssignRoleCode(actor(['ops_admin']), 'ops_admin')).toBe(true);
    expect(() => protectedRoles.assertCanAssignRoleCode(actor(['ops_admin']), 'ops_admin')).not.toThrow();
  });

  it('blocks limited RBAC managers from assigning protected roles', () => {
    expect(protectedRoles.canAssignRoleCode(actor(['custom_rbac_manager']), 'ops_admin')).toBe(false);
    expect(() => protectedRoles.assertCanAssignRoleCode(actor(['custom_rbac_manager']), 'ops_admin')).toThrow(
      /Protected roles/
    );
  });

  it('does not treat scoped staff roles as protected superuser roles', () => {
    for (const roleCode of ['advocate', 'billing_staff', 'case_staff']) {
      expect(protectedRoles.isProtectedRoleCode(roleCode)).toBe(false);
      expect(protectedRoles.canAssignRoleCode(actor(['ops_admin']), roleCode)).toBe(true);
    }
  });

  it('requires protected target roles to be explicitly allowlisted', () => {
    expect(protectedRoles.isProtectedRoleCode('super_admin')).toBe(true);
    expect(protectedRoles.canAssignRoleCode(actor(['ops_admin']), 'super_admin')).toBe(false);
  });
});
