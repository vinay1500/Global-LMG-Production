import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('admin user provisioning guardrails', () => {
  it('exposes admin user creation only through the RBAC-managed settings route', () => {
    const routes = read('admin_backend/src/routes/settings.ts');
    const routeIndex = routes.indexOf("'/settings/admin-users'");
    const nextRouteIndex = routes.indexOf('settingsRouter.', routeIndex + 1);
    const routeBlock = routes.slice(routeIndex, nextRouteIndex === -1 ? routes.length : nextRouteIndex);

    expect(routeIndex).toBeGreaterThan(-1);
    expect(routeBlock).toContain("requireMutationPermission(request, 'rbac.manage')");
    expect(routeBlock).toContain('adminUserCreateSchema.parse(request.body)');
    expect(routes).toContain('roleCode: z.string().trim().min(1).max(64)');
    expect(routes).toContain("provisioningKind: z.enum(['admin', 'advocate', 'billing_staff', 'internal_staff']).optional()");
    expect(routes).toContain('counselPartnerId: z.string().trim().min(1).max(64).nullable().optional()');
    expect(routes).toContain('staffProfileUserId: z.string().trim().min(1).max(64).nullable().optional()');
    expect(routes).toContain("'/settings/admin-users/:userId'");
    expect(routes).toContain('adminUserUpdateSchema.parse(request.body)');
  });

  it('restricts New Admin creation to admin-only payloads', () => {
    const service = read('admin_backend/src/modules/settings/adminUsers.ts');
    const contracts = read('admin_frontend/src/app/lib/api/contracts.ts');

    expect(service).toContain("actor.permissionCodes.includes('rbac.manage')");
    expect(service).toContain("role.code === 'client'");
    expect(service).toContain("provisioningKind !== 'admin'");
    expect(service).toContain('admin_user_provisioning_kind_unsupported');
    expect(service).toContain('admin_user_profile_link_not_allowed');
    expect(service).toContain('ADMIN_USER_CREATE_BLOCKED_ROLE_CODES');
    expect(service).toContain("'case_staff'");
    expect(service).toContain("'advocate'");
    expect(service).toContain("'billing_staff'");
    expect(contracts).toContain("provisioningKind?: 'admin'");
    expect(contracts).not.toContain('staffProfileUserId?: string | null');
    expect(contracts).not.toContain('counselPartnerId?: string | null');
  });

  it('creates admin login access with role, credentials, setup token, preferences, and audits', () => {
    const service = read('admin_backend/src/modules/settings/adminUsers.ts');

    expect(service).toContain("VALUES (?, 'admin'");
    expect(service).not.toContain('INSERT INTO staff_profiles');
    expect(service).toContain('INSERT INTO admin_user_preferences');
    expect(service).toContain('ON DUPLICATE KEY UPDATE updated_at = UTC_TIMESTAMP(6)');
    expect(service).toContain('INSERT INTO user_credentials');
    expect(service).toContain('password_algo');
    expect(service).toContain('password_changed_at');
    expect(service).toContain('INSERT INTO password_reset_tokens');
    expect(service).toContain('sent_at');
    expect(service).toContain('hashPassword(unknownTemporaryPassword)');
    expect(service).toContain('sendEmail({');
    expect(service).toContain("actionCode: 'admin.user_created'");
    expect(service).toContain("actionCode: 'user_role.assigned'");
    expect(service).toContain('admin.setup_email_sent');
  });

  it('uses the shared protected-role assignment guard during admin user creation', () => {
    const service = read('admin_backend/src/modules/settings/adminUsers.ts');
    const protectedRoles = read('admin_backend/src/modules/rbac/protectedRoles.ts');

    expect(protectedRoles).toContain('Protected roles can only be assigned');
    expect(service).toContain('canAssignRoleCode(actor, role.code)');
    expect(service).toContain('admin.protected_role_assignment_denied');
    expect(service).toContain('assertCanAssignRoleCode(actor, role.code)');
    expect(service).toContain("role.code === 'client'");
  });

  it('does not keep scoped login linking in the Admin Users creation path', () => {
    const service = read('admin_backend/src/modules/settings/adminUsers.ts');
    const migrations = read('backend/src/lib/schemaMigrations.ts');

    expect(migrations).toContain('058-counsel-partner-login-links');
    expect(migrations).toContain('CREATE TABLE IF NOT EXISTS counsel_partner_users');
    expect(service).not.toContain('fetchCounselPartnerForProvisioning');
    expect(service).not.toContain('fetchStaffProfileForProvisioning');
    expect(service).not.toContain('INSERT INTO counsel_partner_users');
    expect(service).not.toContain("actionCode: 'advocate.login_linked'");
  });

  it('can disable or re-enable admin login without self or final ops admin lockout', () => {
    const service = read('admin_backend/src/modules/settings/adminUsers.ts');
    const rbacService = read('admin_backend/src/modules/rbac/service.ts');

    expect(service).toContain('export const updateAdminUser');
    expect(service).toContain('self_deactivation_blocked');
    expect(service).toContain('last_ops_admin_blocked');
    expect(service).toContain('UPDATE user_sessions');
    expect(service).not.toContain('UPDATE counsel_partner_users');
    expect(service).not.toContain('UPDATE staff_profiles');
    expect(service).toContain('revoked_at = UTC_TIMESTAMP(6)');
    expect(service).toContain("actionCode: requestedLoginEnabled ? 'admin.user_reactivated' : 'admin.user_deactivated'");
    expect(rbacService).toContain('ADMIN_USERS_EXCLUDED_ROLE_CODES');
    expect(rbacService).toContain('admin_role.role_code NOT IN (?, ?, ?, ?, ?, ?)');
  });

  it('disables linked logins when Team & Counsel profiles are archived', () => {
    const teamRegistry = read('admin_backend/src/modules/settings/teamRegistry.ts');

    expect(teamRegistry).toContain("SET employment_status_code = 'archived'");
    expect(teamRegistry).toContain('SET login_enabled = 0');
    expect(teamRegistry).toContain('UPDATE user_sessions');
    expect(teamRegistry).toContain('UPDATE counsel_partner_users cpu');
    expect(teamRegistry).toContain("cpu.relationship_status_code = 'inactive'");
  });

  it('enables login only from existing Team & Counsel profiles', () => {
    const routes = read('admin_backend/src/routes/settings.ts');
    const teamRegistry = read('admin_backend/src/modules/settings/teamRegistry.ts');
    const rbacService = read('admin_backend/src/modules/rbac/service.ts');

    expect(routes).toContain("'/settings/team/members/:memberId/enable-login'");
    expect(routes).toContain("'/settings/team/members/:memberId/login'");
    expect(routes).toContain("requireMutationPermission(request, 'rbac.manage')");
    expect(routes).toContain("requirePermission(actor, 'counsel_partner.manage')");
    expect(routes).toContain('enableTeamMemberLogin(actor, memberId');
    expect(routes).toContain('updateTeamMemberLogin(actor, memberId');
    expect(teamRegistry).toContain('export const enableTeamMemberLogin');
    expect(teamRegistry).toContain('export const updateTeamMemberLogin');
    expect(teamRegistry).toContain("defaultLoginRoleForTeamMember(existing.type)");
    expect(teamRegistry).toContain("if (type === 'internal_staff')");
    expect(teamRegistry).toContain("return 'case_staff'");
    expect(teamRegistry).toContain("if (type === 'external_counsel')");
    expect(teamRegistry).toContain("return 'advocate'");
    expect(teamRegistry).toContain('field_partner_login_not_enabled');
    expect(teamRegistry).toContain('INSERT INTO counsel_partner_users');
    expect(teamRegistry).toContain('INSERT INTO user_credentials');
    expect(teamRegistry).toContain('INSERT INTO password_reset_tokens');
    expect(teamRegistry).toContain(') VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))');
    expect(teamRegistry).toContain("delivery.setupEmailStatus === 'sent'");
    expect(teamRegistry).toContain("actionCode: existing.type === 'internal_staff' ? 'staff.login_enabled' : 'counsel.login_enabled'");
    expect(teamRegistry).toContain("actionCode: payload.loginEnabled ? 'team_member.login_reenabled' : 'team_member.login_disabled'");
    expect(teamRegistry).toContain('team_member_login_exists');
    expect(teamRegistry).toContain('TEAM_REGISTRY_STAFF_ROLE_CODES');
    expect(rbacService).toContain("COALESCE(cp.partner_type_code, 'external_counsel') = 'external_counsel'");
  });

  it('makes setup-token sent_at nullable for honest manual or disabled setup email states', () => {
    const migrations = read('backend/src/lib/schemaMigrations.ts');
    const adminUsers = read('admin_backend/src/modules/settings/adminUsers.ts');
    const teamRegistry = read('admin_backend/src/modules/settings/teamRegistry.ts');

    expect(migrations).toContain('060-password-reset-token-sent-at-nullability');
    expect(migrations).toContain('ALTER TABLE password_reset_tokens MODIFY COLUMN sent_at DATETIME(6) NULL');
    expect(adminUsers).toContain(') VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))');
    expect(adminUsers).toContain("delivery.setupEmailStatus === 'sent'");
    expect(adminUsers).toContain("? 'admin.setup_email_sent'");
    expect(teamRegistry).toContain(') VALUES (?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))');
    expect(teamRegistry).toContain("delivery.setupEmailStatus === 'sent'");
  });

  it('does not expose generated passwords or accept a password in the create contract', () => {
    const contracts = read('admin_frontend/src/app/lib/api/contracts.ts');
    const form = read('admin_frontend/src/app/modules/SettingsWorkspace.tsx');

    const payloadStart = contracts.indexOf('export interface CreateAdminUserPayload');
    const payloadEnd = contracts.indexOf('export interface CreateAdminUserResponse', payloadStart);
    const payloadBlock = contracts.slice(payloadStart, payloadEnd);

    expect(payloadBlock).not.toMatch(/\bpassword\b/i);
    expect(form).toContain('No password is generated or shown here.');
    expect(form).not.toContain('temporary password');
  });
});
