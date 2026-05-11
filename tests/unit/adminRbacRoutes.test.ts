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

  it('aligns admin frontend navigation and route gates with backend notification, audit, and settings permissions', () => {
    const navigation = read('admin_frontend/src/app/config/navigation.ts');
    const router = read('admin_frontend/src/app/router.tsx');
    const topbar = read('admin_frontend/src/app/layout/AdminTopbar.tsx');

    expect(navigation).toContain("permission: 'notification.view'");
    expect(navigation).toContain("permission: 'audit.view'");
    expect(navigation).toContain("SETTINGS_ROUTE_PERMISSIONS = ['settings.view', 'settings.manage', 'rbac.manage']");
    expect(navigation).not.toContain("id: 'notifications', label: 'Notifications', path: '/notifications', icon: Bell, permission: 'matter.view'");
    expect(navigation).not.toContain("id: 'audit', label: 'Audit Log', path: '/audit', icon: History, permission: 'matter.view'");

    expect(router).toContain('permission="notification.view"');
    expect(router).toContain('permission="audit.view"');
    expect(router).toContain('anyOf={SETTINGS_ROUTE_PERMISSIONS}');
    expect(topbar).toContain("disabled={!hasPermission('notification.view')}");
    expect(topbar).toContain('hasAnyPermission(SETTINGS_ROUTE_PERMISSIONS)');
  });

  it('allows assigned-scope staff and advocates to enter only their scoped admin workspaces', () => {
    const navigation = read('admin_frontend/src/app/config/navigation.ts');
    const router = read('admin_frontend/src/app/router.tsx');
    const topbar = read('admin_frontend/src/app/layout/AdminTopbar.tsx');

    for (const constantName of [
      'CLIENT_ROUTE_PERMISSIONS',
      'MATTER_ROUTE_PERMISSIONS',
      'DOCUMENT_ROUTE_PERMISSIONS',
      'MESSAGE_ROUTE_PERMISSIONS',
      'EVENT_ROUTE_PERMISSIONS',
    ]) {
      expect(navigation).toContain(`export const ${constantName}`);
      expect(router).toContain(`anyOf={${constantName}}`);
    }

    expect(navigation).toContain("'client_account.view_assigned'");
    expect(navigation).toContain("'matter.view_assigned'");
    expect(navigation).toContain("'document.view_assigned'");
    expect(navigation).toContain("'message.view_assigned'");
    expect(navigation).toContain("'event.view_assigned'");
    expect(navigation).toContain("id: 'billing', label: 'Billing & Ledger', path: '/billing', icon: CreditCard, permission: 'invoice.view'");
    expect(navigation).toContain("id: 'audit', label: 'Audit Log', path: '/audit', icon: History, permission: 'audit.view'");
    expect(navigation).toContain("id: 'settings', label: 'Settings', path: '/settings', icon: Settings, permissionsAny: SETTINGS_ROUTE_PERMISSIONS");
    expect(topbar).toContain('hasAnyPermission(MESSAGE_ROUTE_PERMISSIONS)');
    expect(topbar).toContain('hasAnyPermission(EVENT_ROUTE_PERMISSIONS)');
    expect(topbar).toContain('hasAnyPermission(DOCUMENT_ROUTE_PERMISSIONS)');
  });

  it('uses assigned-scope empty states for scoped client and matter lists', () => {
    const clientDirectory = read('admin_frontend/src/app/modules/ClientDirectory.tsx');
    const matterDesk = read('admin_frontend/src/app/modules/MatterDeskAdmin.tsx');
    const clientsPage = read('admin_frontend/src/app/features/clients/ClientsPage.tsx');
    const mattersPage = read('admin_frontend/src/app/features/matters/MattersPage.tsx');

    expect(clientDirectory).toContain('No assigned clients yet.');
    expect(matterDesk).toContain('No assigned matters yet.');
    expect(clientsPage).toContain('client_account.view_assigned');
    expect(mattersPage).toContain('matter.view_assigned');
    expect(clientsPage).toContain("permissionCodes.includes('client_account.manage')");
    expect(mattersPage).toContain("permissionCodes.includes('matter.update')");
  });

  it('requires recipient ownership or notification.manage for notification mutation', () => {
    const service = read('admin_backend/src/modules/notifications/service.ts');

    expect(service).toContain('recipient_user_id AS recipientUserId');
    expect(service).toContain('actor.permissionCodes.includes');
    expect(service).toContain("'notification.manage'");
    expect(service).toContain('notification_recipient_forbidden');
  });

  it('scopes notification listing to the current recipient unless notification.manage is present', () => {
    const service = read('admin_backend/src/modules/notifications/service.ts');
    const route = read('admin_backend/src/routes/notifications.ts');

    expect(service).toContain('const notificationListScope = (actor: AdminActor)');
    expect(service).toContain("actor.permissionCodes.includes('notification.manage')");
    expect(service).toContain('WHERE n.recipient_user_id = ?');
    expect(route).toContain("const actor = await requireReadPermission(request, 'notification.view')");
    expect(route).toContain('await listNotifications(actor');
  });

  it('matches user_roles schema when assigning roles from the RBAC service', () => {
    const service = read('admin_backend/src/modules/rbac/service.ts');
    const userRoleInsertStart = service.indexOf('INSERT INTO user_roles (');
    const userRoleInsertEnd = service.indexOf(
      ') VALUES (?, ?, ?, NULL, NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
      userRoleInsertStart
    );
    const userRoleInsert = service.slice(userRoleInsertStart, userRoleInsertEnd);

    expect(userRoleInsert).toContain('created_at');
    expect(userRoleInsert).toContain('updated_at');
    expect(userRoleInsert).not.toContain('granted_at');
  });

  it('protects superuser role assignment from limited RBAC managers', () => {
    const service = read('admin_backend/src/modules/rbac/service.ts');
    const protectedRoles = read('admin_backend/src/modules/rbac/protectedRoles.ts');

    expect(protectedRoles).toContain('PROTECTED_ROLE_CODES');
    expect(protectedRoles).toContain("'ops_admin'");
    expect(protectedRoles).toContain('ASSIGNABLE_PROTECTED_ROLE_CODES');
    expect(service).toContain('canAssignRoleCode(actor, role.code)');
    expect(service).toContain('user_role.protected_assignment_denied');
    expect(service).toContain('assertCanAssignRoleCode(actor, role.code)');
  });

  it('requires operational profiles before scoped staff or advocate role assignment', () => {
    const service = read('admin_backend/src/modules/rbac/service.ts');

    expect(service).toContain('STAFF_PROFILE_REQUIRED_ROLE_CODES');
    expect(service).toContain("'case_staff'");
    expect(service).toContain("'field_staff'");
    expect(service).toContain("'internal_staff'");
    expect(service).toContain('staff_profile_required_for_role');
    expect(service).toContain('FROM staff_profiles sp');
    expect(service).toContain("sp.employment_status_code = 'active'");
    expect(service).toContain("existing_ur.role_code NOT IN ('case_staff', 'field_staff', 'internal_staff')");
    expect(service).toContain("u.actor_type_code = 'admin'");
    expect(service).toContain('u.login_enabled = 0');
    expect(service).toContain('advocate_profile_required_for_role');
    expect(service).toContain('FROM counsel_partner_users cpu');
    expect(service).toContain('COALESCE(cp.partner_type_code');
    expect(service).toContain('await assertOperationalProfileForRole(user, role.code, connection)');
  });

  it('blocks bootstrap from creating profile-scoped operational login users', () => {
    const bootstrap = read('admin_backend/src/scripts/bootstrapAdmin.ts');

    expect(bootstrap).toContain('BOOTSTRAP_SAFE_ADMIN_ROLE_CODES');
    expect(bootstrap).toContain("'ops_admin'");
    expect(bootstrap).toContain('is not bootstrap-safe');
    expect(bootstrap).toContain("VALUES (\n           ?, ?, NULL, ?, ?, ?, 'admin'");
    expect(bootstrap).toContain("actor_type_code = 'admin'");
    expect(bootstrap).not.toContain('PROFILE_REQUIRED_BOOTSTRAP_ROLE_CODES');
  });

  it('seeds required notification and audit permissions', () => {
    const referenceData = read('backend/src/modules/platform/referenceData.ts');
    const migrations = read('backend/src/lib/schemaMigrations.ts');

    for (const permission of ['notification.view', 'notification.manage', 'audit.view']) {
      expect(referenceData).toContain(permission);
      expect(migrations).toContain(permission);
    }
  });

  it('seeds restricted staff and advocate roles with scoped permissions only', () => {
    const referenceData = read('backend/src/modules/platform/referenceData.ts');
    const migrations = read('backend/src/lib/schemaMigrations.ts');
    const rolePermissionSeeds = referenceData.slice(
      referenceData.indexOf('export const ROLE_PERMISSION_SEEDS')
    );
    const billingStaffBlock = rolePermissionSeeds.slice(
      rolePermissionSeeds.indexOf("'billing_staff'"),
      rolePermissionSeeds.indexOf("'case_staff'")
    );
    const caseStaffBlock = rolePermissionSeeds.slice(
      rolePermissionSeeds.indexOf("'case_staff'"),
      rolePermissionSeeds.indexOf("'advocate'")
    );
    const advocateBlock = rolePermissionSeeds.slice(
      rolePermissionSeeds.indexOf("'advocate'"),
      rolePermissionSeeds.indexOf("'ops_admin'")
    );

    for (const roleCode of ['billing_staff', 'case_staff', 'advocate']) {
      expect(referenceData).toContain(`code: '${roleCode}'`);
      expect(migrations).toContain(roleCode);
    }

    expect(billingStaffBlock).toContain("'invoice.view'");
    expect(billingStaffBlock).toContain("'payment.view'");
    expect(billingStaffBlock).toContain("'refund.view'");
    expect(billingStaffBlock).not.toContain("'dashboard.view'");
    expect(billingStaffBlock).not.toContain("'notification.view'");
    expect(billingStaffBlock).not.toContain("'document.view'");
    expect(billingStaffBlock).not.toContain("'message.send'");

    for (const permission of [
      'client_account.view_assigned',
      'matter.view_assigned',
      'matter.update_assigned',
      'document.view_assigned',
      'document.download_assigned',
      'message.view_assigned',
      'message.send_assigned',
      'event.view_assigned',
    ]) {
      expect(caseStaffBlock).toContain(`'${permission}'`);
      expect(migrations).toContain(permission);
    }

    expect(advocateBlock).toContain("'matter.view_assigned'");
    expect(advocateBlock).toContain("'document.view_assigned'");
    expect(advocateBlock).toContain("'document.download_assigned'");
    expect(advocateBlock).toContain("'message.view_assigned'");
    expect(advocateBlock).toContain("'message.send_assigned'");
    expect(advocateBlock).toContain("'event.view_assigned'");
    expect(advocateBlock).not.toContain("'client_account.view_assigned'");
    expect(advocateBlock).not.toContain("'invoice.view'");
    expect(advocateBlock).not.toContain("'payment.view'");
    expect(advocateBlock).not.toContain("'audit.view'");
    expect(advocateBlock).not.toContain("'settings.manage'");
    expect(advocateBlock).not.toContain("'rbac.manage'");
  });

  it('does not advertise unseeded bootstrap roles as built-in env choices', () => {
    const envConfig = read('admin_backend/src/config/env.ts');
    const adminEnvExample = read('admin_backend/.env.example');
    const deployEnvExample = read('deploy/env/admin_backend.env.production.example');

    expect(envConfig).not.toContain('messaging_desk\', \'management_viewer');
    expect(adminEnvExample).toContain(
      'Seeded operational roles also include case_manager, billing_admin, billing_staff, case_staff, and advocate.'
    );
    expect(deployEnvExample).toContain(
      'Seeded operational roles also include case_manager, billing_admin, billing_staff, case_staff, and advocate.'
    );
  });

  it('keeps assigned matter updates away from pricing and service/package fields', () => {
    const mattersService = read('admin_backend/src/modules/matters/service.ts');
    const matterDetailPage = read('admin_frontend/src/app/features/matters/MatterDetailPage.tsx');
    const matterDetailAdmin = read('admin_frontend/src/app/modules/MatterDetailAdmin.tsx');

    expect(mattersService).toContain('ASSIGNED_MATTER_DETAIL_UPDATE_FIELDS');
    expect(mattersService).toContain("'operationalStatusCode'");
    expect(mattersService).toContain('matter_assigned_update_field_forbidden');
    expect(mattersService).toContain('quotedTotalAmount');
    expect(mattersService).toContain('selectedServices');
    expect(matterDetailPage).toContain("const canManageMatter = permissionCodes.includes('matter.update')");
    expect(matterDetailPage).toContain('onUpdateFee={canManageMatter ? handleUpdateFee : undefined}');
    expect(matterDetailPage).toContain('onSavePackageDraft={canManageMatter ? async');
    expect(matterDetailAdmin).toContain('const canManagePackages = Boolean');
    expect(matterDetailAdmin).toContain('{canManagePackages || packageWorkspace ? (');
  });

  it('adds a standalone matter_documents document index for assigned document scope checks', () => {
    const migrations = read('backend/src/lib/schemaMigrations.ts');

    expect(migrations).toContain("id: '059-matter-documents-document-index'");
    expect(migrations).toContain("index_name = 'idx_matter_documents_document'");
    expect(migrations).toContain('ALTER TABLE matter_documents ADD INDEX idx_matter_documents_document (document_id)');
  });
});
