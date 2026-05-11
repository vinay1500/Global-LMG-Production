import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('admin user provisioning UI contract', () => {
  it('moves login user management out of Roles & Permissions', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');

    expect(workspace).toContain("!workspace.rbac.canManage");
    expect(workspace).toContain("{ id: 'adminUsers', label: 'Admin Users' }");
    expect(workspace).toContain("type RbacWorkspaceTab = 'advanced' | 'overview' | 'roles'");
    expect(workspace).toContain('Staff and counsel profiles are created in Team & Counsel. Admin login users are managed in Admin Users.');
    expect(workspace).not.toContain('New Login User');
    expect(workspace).not.toContain('Choose user type');
    expect(workspace).not.toContain('Counsel registry entry');
    expect(workspace).not.toContain('Team & Counsel staff profile');
  });

  it('keeps New Admin admin-only and avoids password/token disclosure', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');

    expect(workspace).toContain('New Admin');
    expect(workspace).toContain('Create only admin or internal admin accounts here.');
    expect(workspace).toContain('Staff, advocate, client, and billing roles are not available in the New Admin flow.');
    expect(workspace).toContain('ADMIN_USER_CREATION_BLOCKED_ROLE_CODES');
    expect(workspace).toContain('submitAdminUser');
    expect(workspace).toContain('Send setup email');
    expect(workspace).toContain('No password is generated or shown here.');
    expect(workspace).not.toContain('ADMIN_USER_KIND_OPTIONS');
    expect(workspace).not.toContain('Create User');
    expect(workspace).not.toContain('Raw password');
    expect(workspace).not.toContain('setup token');
  });

  it('keeps advanced RBAC controls while exposing simpler tabs and summaries', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');

    expect(workspace).toContain('AccessSummaryCard');
    expect(workspace).toContain('Admin Users');
    expect(workspace).toContain('Advanced Permissions');
    expect(workspace).toContain('Open advanced permission editor');
    expect(workspace).toContain('selectedPermissionCodes.includes(permission.code)');
    expect(workspace).toContain('Save Permissions');
  });

  it('explains scoped access and marks protected roles without exposing unsafe actions', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');

    expect(workspace).toContain('Roles decide what modules a user can access.');
    expect(workspace).toContain('Missing assignment never means global access.');
    expect(workspace).toContain('Create staff and counsel profiles in Team & Counsel first');
    expect(workspace).toContain('Protected role');
    expect(workspace).toContain('Protected roles include ops_admin');
    expect(workspace).toContain('No login users yet.');
    expect(workspace).toContain('No permissions in this module.');
    expect(workspace).not.toContain('setup token');
    expect(workspace).not.toContain('temporary password');
  });

  it('wires the create admin endpoint through the settings page and API client', () => {
    const page = read('src/app/features/settings/SettingsPage.tsx');
    const api = read('src/app/lib/api/admin.ts');
    const endpoints = read('src/app/lib/api/endpoints.ts');

    expect(page).toContain('onCreateAdminUser');
    expect(page).toContain('onUpdateAdminUser');
    expect(api).toContain('createAdminUser');
    expect(api).toContain('updateAdminUser');
    expect(api).toContain("createIdempotencyIdentity('admin-user-create'");
    expect(api).toContain("payload.provisioningKind || 'admin'");
    expect(api).not.toContain("payload.counselPartnerId || ''");
    expect(api).not.toContain("payload.staffProfileUserId || ''");
    expect(endpoints).toContain('/v1/admin/settings/admin-users');
    expect(endpoints).toContain('/v1/admin/settings/admin-users/${encodeURIComponent(userId)}');
  });

  it('shows admin login status controls without exposing passwords', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');

    expect(workspace).toContain('Login enabled');
    expect(workspace).toContain('Login disabled');
    expect(workspace).toContain('Disable login');
    expect(workspace).toContain('Enable login');
    expect(workspace).toContain('updateAdminUserLogin');
    expect(workspace).toContain('assignAdminUserRole');
    expect(workspace).toContain('removeAdminUserRole');
    expect(workspace).toContain('Admin role assigned.');
    expect(workspace).toContain('Admin role removed.');
    expect(workspace).not.toContain('temporary password');
  });

  it('enables login from Team & Counsel profiles instead of Roles & Permissions', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');
    const page = read('src/app/features/settings/SettingsPage.tsx');
    const api = read('src/app/lib/api/admin.ts');
    const endpoints = read('src/app/lib/api/endpoints.ts');

    expect(workspace).toContain('Profiles come first, login comes second.');
    expect(workspace).toContain('Use Enable login on an existing profile');
    expect(workspace).toContain('enableTeamMemberLogin');
    expect(workspace).toContain('loginRoleForTeamMember');
    expect(workspace).toContain("return 'case_staff'");
    expect(workspace).toContain("return 'advocate'");
    expect(workspace).toContain('Field partner login is not enabled yet.');
    expect(workspace).toContain('Enable staff login');
    expect(workspace).toContain('Enable advocate login');
    expect(workspace).toContain('Re-enable login');
    expect(workspace).toContain('Disable login');
    expect(workspace).toContain('updateTeamMemberLogin');
    expect(page).toContain('onEnableTeamMemberLogin');
    expect(page).toContain('onUpdateTeamMemberLogin');
    expect(api).toContain('enableTeamMemberLogin');
    expect(api).toContain('updateTeamMemberLogin');
    expect(endpoints).toContain('/v1/admin/settings/team/members/${encodeURIComponent(memberId)}/enable-login');
    expect(endpoints).toContain('/v1/admin/settings/team/members/${encodeURIComponent(memberId)}/login');
  });

  it('keeps legal domains editable while primary services stay domain-independent', () => {
    const workspace = read('src/app/modules/SettingsWorkspace.tsx');
    const page = read('src/app/features/settings/SettingsPage.tsx');
    const api = read('src/app/lib/api/admin.ts');
    const endpoints = read('src/app/lib/api/endpoints.ts');

    expect(workspace).toContain('Create Legal Domain');
    expect(workspace).toContain('Legal domains classify requests and matters. Primary services stay independent.');
    expect(workspace).toContain('sortedServiceDomains');
    expect(workspace).toContain('submitServiceDomain');
    expect(workspace).not.toContain('Optional Internal Category');
    expect(workspace).not.toContain('Internal category:');
    expect(page).toContain('onCreateServiceDomain');
    expect(page).toContain('onUpdateServiceDomain');
    expect(page).toContain('onArchiveServiceDomain');
    expect(api).toContain('createServiceCatalogDomain');
    expect(api).toContain('updateServiceCatalogDomain');
    expect(api).toContain('archiveServiceCatalogDomain');
    expect(endpoints).toContain('/v1/admin/settings/service-catalog/domains');
  });
});
