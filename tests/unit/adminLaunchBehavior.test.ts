import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminActor } from '../../admin_backend/src/modules/auth/service.js';

const mysqlMock = vi.hoisted(() => ({
  executeStatement: vi.fn(async () => ({ affectedRows: 1, insertId: 1 })),
  queryRows: vi.fn(),
  withTransaction: vi.fn(async (callback: (connection: { test: true }) => unknown) =>
    callback({ test: true })
  ),
}));

const auditMock = vi.hoisted(() => ({
  createAuditEvent: vi.fn(async () => undefined),
}));

const platformSettingsMock = vi.hoisted(() => ({
  getAdminMfaRequirementMode: vi.fn(async () => 'disabled'),
  getPlatformDefaultTimezone: vi.fn(async () => 'UTC'),
}));

vi.mock('../../admin_backend/src/lib/mysql.js', () => mysqlMock);
vi.mock('../../admin_backend/src/modules/writeSupport.js', () => auditMock);
vi.mock('../../admin_backend/src/modules/settings/platformSettings.js', () => platformSettingsMock);

const actor = (
  roleCodes: string[],
  permissionCodes: string[] = [],
  overrides: Partial<AdminActor> = {}
): AdminActor => ({
  displayName: 'Persona User',
  email: 'persona@example.local',
  id: 'user_persona',
  mustRotatePassword: false,
  permissionCodes,
  roleCodes,
  userId: 42,
  ...overrides,
});

const resetDatabaseMocks = () => {
  mysqlMock.executeStatement.mockClear();
  mysqlMock.queryRows.mockReset();
  mysqlMock.withTransaction.mockClear();
  auditMock.createAuditEvent.mockClear();
  platformSettingsMock.getAdminMfaRequirementMode.mockClear();
  platformSettingsMock.getPlatformDefaultTimezone.mockClear();
};

const executedSql = () =>
  mysqlMock.executeStatement.mock.calls.map((call) => String(call[0]).replace(/\s+/g, ' '));

const querySql = () => mysqlMock.queryRows.mock.calls.map((call) => String(call[0]).replace(/\s+/g, ' '));

const seedMatterRows = () => {
  mysqlMock.queryRows
    .mockResolvedValueOnce([
      {
        assignedCounsel: 'External Counsel',
        assignedFieldPartners: null,
        assignedStaff: 'Internal Staff',
        clientId: 'client_public',
        clientName: 'Client Name',
        consultationMode: 'video',
        createdAt: '2026-01-01 10:00:00',
        dbId: 100,
        dueAmount: 800,
        expertiseArea: 'Corporate',
        id: 'matter_public',
        issueSummary: 'Sensitive issue summary',
        lastUpdated: '2026-01-02 10:00:00',
        lifecycleStage: 'consultation',
        matterNumber: 'MAT-100',
        meetingLink: 'https://meet.example.local/private',
        operationalStatus: 'active',
        paidAmount: 200,
        title: 'Matter Title',
        totalFee: 1000,
        urgency: 'standard',
      },
    ])
    .mockResolvedValueOnce([
      { dbId: 100, serviceCode: 'premium_package' },
      { dbId: 100, serviceCode: 'pricing_sensitive_service' },
    ])
    .mockResolvedValueOnce([
      { bodyText: 'Client-visible update', dbId: 100, visibleToClient: 1 },
      { bodyText: 'Internal-only update', dbId: 100, visibleToClient: 0 },
    ])
    .mockResolvedValueOnce([
      {
        dbId: 100,
        id: 'visible_assignee',
        name: 'Visible Assignee',
        type: 'external_counsel',
        visibleToClient: 1,
      },
      {
        dbId: 100,
        id: 'internal_assignee',
        name: 'Internal Assignee',
        type: 'internal_staff',
        visibleToClient: 0,
      },
    ]);
};

describe('admin launch-blocker behavior regressions', () => {
  beforeEach(() => {
    process.env.AUTH_SESSION_SECRET ||= 'unit-admin-launch-behavior-secret-1234567890';
    resetDatabaseMocks();
  });

  it('creates New Admin users as admin actors without writing staff_profiles', async () => {
    const { createAdminUser } = await import('../../admin_backend/src/modules/settings/adminUsers.js');
    mysqlMock.queryRows
      .mockResolvedValueOnce([{ code: 'case_manager', isActive: 1, isSystem: 0, name: 'Case Manager' }])
      .mockResolvedValueOnce([]);

    const response = await createAdminUser(actor(['ops_admin'], ['rbac.manage']), {
      displayName: 'New Admin',
      email: 'new-admin@example.local',
      loginEnabled: false,
      roleCode: 'case_manager',
    });

    const sql = executedSql().join('\n');
    expect(response.status).toBe('created');
    expect(response.user.roleCodes).toEqual(['case_manager']);
    expect(sql).toContain("VALUES (?, 'admin'");
    expect(sql).toContain('INSERT INTO admin_user_preferences');
    expect(sql).toContain('INSERT INTO user_credentials');
    expect(sql).toContain('INSERT INTO user_roles');
    expect(sql).not.toContain('staff_profiles');
  });

  it('rejects scoped and profile-linked Admin Users provisioning payloads before database writes', async () => {
    const { createAdminUser } = await import('../../admin_backend/src/modules/settings/adminUsers.js');

    await expect(
      createAdminUser(actor(['ops_admin'], ['rbac.manage']), {
        displayName: 'Scoped User',
        email: 'scoped@example.local',
        provisioningKind: 'internal_staff',
        roleCode: 'case_staff',
      })
    ).rejects.toMatchObject({
      code: 'admin_user_provisioning_kind_unsupported',
      statusCode: 400,
    });

    await expect(
      createAdminUser(actor(['ops_admin'], ['rbac.manage']), {
        counselPartnerId: 'counsel_public',
        displayName: 'Linked User',
        email: 'linked@example.local',
        roleCode: 'case_manager',
      })
    ).rejects.toMatchObject({
      code: 'admin_user_profile_link_not_allowed',
      statusCode: 400,
    });

    expect(mysqlMock.queryRows).not.toHaveBeenCalled();
    expect(mysqlMock.executeStatement).not.toHaveBeenCalled();
  });

  it('updates admin account identity without creating or updating staff_profiles', async () => {
    const { updateAdminProfile } = await import('../../admin_backend/src/modules/account/service.js');
    mysqlMock.queryRows
      .mockResolvedValueOnce([{ countValue: 0 }])
      .mockResolvedValueOnce([
        {
          avatarUrl: null,
          city: null,
          dateFormat: null,
          defaultLandingPath: null,
          densityCode: null,
          displayName: 'Old Admin',
          email: 'admin@example.local',
          firstName: 'Old',
          inAppNotificationsEnabled: null,
          jobTitle: null,
          lastName: 'Admin',
          mfaEnabledAt: null,
          phone: null,
          state: null,
          timezoneName: 'UTC',
        },
      ])
      .mockResolvedValueOnce([
        {
          avatarColor: '#2C2B29',
          avatarUrl: null,
          city: null,
          dateFormat: 'DD/MM/YYYY',
          defaultLandingPath: '/dashboard',
          densityCode: 'comfortable',
          displayName: 'Launch Admin',
          email: 'admin@example.local',
          firstName: 'Launch',
          inAppNotificationsEnabled: 1,
          jobTitle: null,
          lastName: 'Admin',
          mfaEnabledAt: null,
          phone: '+15550000000',
          state: null,
          timezoneName: 'UTC',
        },
      ]);

    const response = await updateAdminProfile(actor(['ops_admin']), {
      city: 'Ignored City',
      displayName: 'Launch Admin',
      jobTitle: 'Ignored Job',
      phone: '+15550000000',
      state: 'Ignored State',
    });

    expect(response.profile.displayName).toBe('Launch Admin');
    expect(executedSql().join('\n')).toContain('UPDATE users');
    expect(executedSql().join('\n')).not.toContain('staff_profiles');
  });

  it('hides selectedServices and financial/internal matter fields for case_staff', async () => {
    const { fetchMatters } = await import('../../admin_backend/src/modules/shared.js');
    seedMatterRows();

    const [matter] = await fetchMatters({ actor: actor(['case_staff']), matterIds: ['matter_public'] });

    expect(matter?.selectedServices).toEqual([]);
    expect(matter?.totalFee).toBeUndefined();
    expect(matter?.paidAmount).toBeUndefined();
    expect(matter?.dueAmount).toBeUndefined();
    expect(matter?.internalNotes).toEqual([]);
    expect(matter?.meetingLink).toBeUndefined();
    expect(matter?.assignedStaff).toBeUndefined();
    expect(matter?.assignments).toEqual([
      {
        id: 'visible_assignee',
        name: 'Visible Assignee',
        type: 'external_counsel',
        visibleToClient: true,
      },
    ]);
  });

  it('hides selectedServices and financial/internal matter fields for advocates', async () => {
    const { fetchMatters } = await import('../../admin_backend/src/modules/shared.js');
    seedMatterRows();

    const [matter] = await fetchMatters({ actor: actor(['advocate']), matterIds: ['matter_public'] });

    expect(matter?.selectedServices).toEqual([]);
    expect(matter?.totalFee).toBeUndefined();
    expect(matter?.paidAmount).toBeUndefined();
    expect(matter?.dueAmount).toBeUndefined();
    expect(matter?.internalNotes).toEqual([]);
  });

  it('preserves selectedServices and financial/internal matter fields for ops_admin', async () => {
    const { fetchMatters } = await import('../../admin_backend/src/modules/shared.js');
    seedMatterRows();

    const [matter] = await fetchMatters({ actor: actor(['ops_admin']), matterIds: ['matter_public'] });

    expect(matter?.selectedServices).toEqual(['premium_package', 'pricing_sensitive_service']);
    expect(matter?.totalFee).toBe(1000);
    expect(matter?.paidAmount).toBe(200);
    expect(matter?.dueAmount).toBe(800);
    expect(matter?.internalNotes).toEqual(['Internal-only update']);
    expect(matter?.assignedStaff).toBe('Internal Staff');
  });

  it('returns empty scoped matter lists and denies direct matter access when no assignments exist', async () => {
    const { canAccessMatter, getScopedMatterIds } = await import(
      '../../admin_backend/src/modules/access/scope.js'
    );

    mysqlMock.queryRows.mockResolvedValueOnce([]);
    await expect(getScopedMatterIds(actor(['case_staff']))).resolves.toEqual([]);

    mysqlMock.queryRows.mockResolvedValueOnce([]);
    await expect(getScopedMatterIds(actor(['advocate']))).resolves.toEqual([]);

    mysqlMock.queryRows.mockResolvedValueOnce([]);
    await expect(canAccessMatter(actor(['case_staff']), 'unassigned_matter')).resolves.toBe(false);

    mysqlMock.queryRows.mockResolvedValueOnce([]);
    await expect(canAccessMatter(actor(['advocate']), 'unassigned_matter')).resolves.toBe(false);
  });

  it('blocks scoped role assignment without the required active Team & Counsel profile or link', async () => {
    const { assignUserRole } = await import('../../admin_backend/src/modules/rbac/service.js');

    mysqlMock.queryRows
      .mockResolvedValueOnce([
        {
          actorTypeCode: 'admin',
          displayName: 'Floating Admin',
          email: 'floating@example.local',
          id: 77,
          publicId: 'floating_admin',
        },
      ])
      .mockResolvedValueOnce([
        { code: 'case_staff', description: 'Scoped staff', isActive: 1, isSystem: 0, name: 'Case Staff' },
      ])
      .mockResolvedValueOnce([]);

    await expect(assignUserRole(actor(['ops_admin'], ['rbac.manage']), 'floating_admin', 'case_staff')).rejects.toMatchObject({
      code: 'staff_profile_required_for_role',
      statusCode: 400,
    });

    resetDatabaseMocks();
    mysqlMock.queryRows
      .mockResolvedValueOnce([
        {
          actorTypeCode: 'counsel',
          displayName: 'Floating Counsel',
          email: 'counsel@example.local',
          id: 88,
          publicId: 'floating_counsel',
        },
      ])
      .mockResolvedValueOnce([
        { code: 'advocate', description: 'Scoped advocate', isActive: 1, isSystem: 0, name: 'Advocate' },
      ])
      .mockResolvedValueOnce([]);

    await expect(assignUserRole(actor(['ops_admin'], ['rbac.manage']), 'floating_counsel', 'advocate')).rejects.toMatchObject({
      code: 'advocate_profile_required_for_role',
      statusCode: 400,
    });
  });

  it('allows scoped staff role assignment when the active Team & Counsel staff profile exists', async () => {
    const { assignUserRole } = await import('../../admin_backend/src/modules/rbac/service.js');

    mysqlMock.queryRows
      .mockResolvedValueOnce([
        {
          actorTypeCode: 'admin',
          displayName: 'Prelogin Staff',
          email: 'staff@example.local',
          id: 99,
          publicId: 'prelogin_staff',
        },
      ])
      .mockResolvedValueOnce([
        { code: 'case_staff', description: 'Scoped staff', isActive: 1, isSystem: 0, name: 'Case Staff' },
      ])
      .mockResolvedValueOnce([{ ok: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(assignUserRole(actor(['ops_admin'], ['rbac.manage']), 'prelogin_staff', 'case_staff')).resolves.toEqual({
      status: 'assigned',
    });
    expect(executedSql().join('\n')).toContain('INSERT INTO user_roles');
  });

  it('enables Team & Counsel staff login with the case_staff role', async () => {
    const { enableTeamMemberLogin } = await import(
      '../../admin_backend/src/modules/settings/teamRegistry.js'
    );
    const staffRow = {
      accountStatusCode: 'active',
      activeRoleCount: 0,
      dbId: 222,
      email: 'staff.member@example.local',
      employmentStatusCode: 'active',
      hasCredentials: 0,
      id: 'staff_member_public',
      loginEnabled: 0,
      name: 'Staff Member',
      phone: null,
    };

    mysqlMock.queryRows
      .mockResolvedValueOnce([staffRow])
      .mockResolvedValueOnce([{ code: 'case_staff', isActive: 1, name: 'Case Staff' }])
      .mockResolvedValueOnce([staffRow]);

    const response = await enableTeamMemberLogin(
      actor(['ops_admin'], ['rbac.manage']),
      'staff_member_public',
      { sendSetupEmail: false }
    );

    expect(response.status).toBe('enabled');
    expect(response.setupEmailStatus).toBe('manual_required');
    expect(response.user.roleCodes).toEqual(['case_staff']);
    const sql = executedSql().join('\n');
    const params = mysqlMock.executeStatement.mock.calls.map((call) => call[1]);
    expect(sql).toContain("actor_type_code = 'staff'");
    expect(sql).toContain('INSERT INTO user_roles');
    expect(params).toContainEqual([222, 'case_staff', 42]);
  });

  it('keeps field partner login blocked in Team & Counsel', async () => {
    const { enableTeamMemberLogin } = await import(
      '../../admin_backend/src/modules/settings/teamRegistry.js'
    );

    mysqlMock.queryRows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          dbId: 333,
          id: 'field_partner_public',
          name: 'Field Partner',
          type: 'field_partner',
        },
      ]);

    await expect(
      enableTeamMemberLogin(actor(['ops_admin'], ['rbac.manage']), 'field_partner_public')
    ).rejects.toMatchObject({
      code: 'field_partner_login_not_enabled',
      statusCode: 400,
    });
    expect(mysqlMock.executeStatement).not.toHaveBeenCalled();
  });

  it('keeps protected role assignment restricted to protected administrators', async () => {
    const { assignUserRole } = await import('../../admin_backend/src/modules/rbac/service.js');

    mysqlMock.queryRows
      .mockResolvedValueOnce([
        {
          actorTypeCode: 'admin',
          displayName: 'Target Admin',
          email: 'target@example.local',
          id: 111,
          publicId: 'target_admin',
        },
      ])
      .mockResolvedValueOnce([
        { code: 'ops_admin', description: 'Ops admin', isActive: 1, isSystem: 0, name: 'Ops Admin' },
      ]);

    await expect(
      assignUserRole(actor(['custom_rbac_manager'], ['rbac.manage']), 'target_admin', 'ops_admin')
    ).rejects.toMatchObject({
      code: 'protected_role_assignment_forbidden',
      statusCode: 403,
    });
  });

  it('does not resolve stale sessions when the active-account query returns no actor rows', async () => {
    const { getSession } = await import('../../admin_backend/src/modules/auth/service.js');
    mysqlMock.queryRows.mockResolvedValueOnce([]);
    const headers: Record<string, unknown> = {};
    const response = {
      getHeader: (name: string) => headers[name],
      setHeader: (name: string, value: unknown) => {
        headers[name] = value;
      },
    };

    await expect(
      getSession(
        { headers: { cookie: 'global_lmg_admin_session=stale-session-token' } } as never,
        response as never
      )
    ).resolves.toMatchObject({ authenticated: false, user: null });
    expect(querySql().join('\n')).toContain("u.account_status_code = 'active'");
    expect(querySql().join('\n')).toContain('u.actor_type_code <>');
    expect(headers['Set-Cookie']).toBeTruthy();
  });

  it('creates primary services without writing or returning legal domain linkage', async () => {
    const { createService } = await import('../../admin_backend/src/modules/settings/catalogPricing.js');

    mysqlMock.queryRows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'service_public' }])
      .mockResolvedValueOnce([
        {
          baseFee: 1250,
          code: 'independent-service',
          dbId: 901,
          description: 'Standalone service',
          icon: 'Briefcase',
          id: 'service_public',
          isActive: 1,
          name: 'Independent Service',
          sortOrder: 4,
        },
      ]);

    const response = await createService(actor(['ops_admin'], ['settings.manage']), {
      baseFee: 1250,
      code: 'independent-service',
      description: 'Standalone service',
      name: 'Independent Service',
      sortOrder: 4,
    });

    const sql = executedSql().join('\n');
    expect(response).toMatchObject({
      code: 'independent-service',
      name: 'Independent Service',
    });
    expect(response).not.toHaveProperty('domainCode');
    expect(response).not.toHaveProperty('domainName');
    expect(sql).toContain('INSERT INTO services');
    expect(sql).not.toContain('legal_domain_id');
    expect(auditMock.createAuditEvent.mock.calls[0]?.[0]?.changes).not.toContainEqual(
      expect.objectContaining({ fieldName: 'domain_code' })
    );
  });

  it('manages legal domains independently from primary services', async () => {
    const { archiveServiceDomain, createServiceDomain, updateServiceDomain } = await import(
      '../../admin_backend/src/modules/settings/catalogPricing.js'
    );

    mysqlMock.queryRows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: 'immigration', dbId: 701, isActive: 1, name: 'Immigration', sortOrder: 11 },
      ]);

    await expect(
      createServiceDomain(actor(['ops_admin'], ['settings.manage']), {
        code: 'immigration',
        name: 'Immigration',
        sortOrder: 11,
      })
    ).resolves.toMatchObject({ code: 'immigration', isActive: true, name: 'Immigration' });

    resetDatabaseMocks();
    mysqlMock.queryRows
      .mockResolvedValueOnce([
        { code: 'immigration', dbId: 701, isActive: 1, name: 'Immigration', sortOrder: 11 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: 'immigration', dbId: 701, isActive: 1, name: 'Immigration Law', sortOrder: 12 },
      ]);

    await expect(
      updateServiceDomain(actor(['ops_admin'], ['settings.manage']), 'immigration', {
        name: 'Immigration Law',
        sortOrder: 12,
      })
    ).resolves.toMatchObject({ code: 'immigration', name: 'Immigration Law', sortOrder: 12 });

    resetDatabaseMocks();
    mysqlMock.queryRows
      .mockResolvedValueOnce([
        { code: 'immigration', dbId: 701, isActive: 1, name: 'Immigration Law', sortOrder: 12 },
      ])
      .mockResolvedValueOnce([
        { code: 'immigration', dbId: 701, isActive: 0, name: 'Immigration Law', sortOrder: 12 },
      ]);

    await expect(
      archiveServiceDomain(actor(['ops_admin'], ['settings.manage']), 'immigration')
    ).resolves.toMatchObject({ code: 'immigration', isActive: false });

    const sql = executedSql().join('\n');
    expect(sql).toContain('UPDATE legal_domains');
    expect(sql).not.toContain('services');
  });
});
