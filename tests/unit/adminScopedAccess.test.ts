import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminActor } from '../../admin_backend/src/modules/auth/service.js';
import type * as AccessScopeModule from '../../admin_backend/src/modules/access/scope.js';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

let accessScope: typeof AccessScopeModule;

const actor = (roleCodes: string[]): AdminActor => ({
  displayName: 'Scoped User',
  email: 'scoped@example.local',
  id: 'user_public_id',
  mustRotatePassword: false,
  permissionCodes: [],
  roleCodes,
  userId: 123,
});

describe('admin scoped access helpers', () => {
  beforeAll(async () => {
    process.env.AUTH_SESSION_SECRET ||= 'unit-test-admin-scoped-access-secret-1234567890';
    accessScope = await import('../../admin_backend/src/modules/access/scope.js');
  });

  it('classifies ops, billing, case staff, and advocate actors without granting implicit global scope', () => {
    expect(accessScope.getAdminAccessScope(actor(['ops_admin']))).toMatchObject({
      canAccessAll: true,
      isBillingStaff: false,
      isCaseStaff: false,
      isAdvocate: false,
    });
    expect(accessScope.getAdminAccessScope(actor(['billing_staff']))).toMatchObject({
      canAccessAll: false,
      isBillingStaff: true,
      hasAssignedMatterScope: false,
    });
    expect(accessScope.getAdminAccessScope(actor(['case_staff']))).toMatchObject({
      canAccessAll: false,
      isCaseStaff: true,
      hasAssignedMatterScope: true,
    });
    expect(accessScope.getAdminAccessScope(actor(['advocate']))).toMatchObject({
      canAccessAll: false,
      isAdvocate: true,
      hasAssignedMatterScope: true,
    });
  });

  it('uses null for unrestricted ops scope and empty lists for non-applicable restricted scopes', async () => {
    await expect(accessScope.getScopedMatterIds(actor(['ops_admin']))).resolves.toBeNull();
    await expect(accessScope.getScopedClientAccountIds(actor(['ops_admin']))).resolves.toBeNull();
    await expect(accessScope.getScopedMatterIds(actor(['billing_staff']))).resolves.toEqual([]);
    await expect(accessScope.getScopedClientAccountIds(actor(['advocate']))).resolves.toEqual([]);
  });

  it('denies unsupported restricted access without querying broad/global records', async () => {
    await expect(accessScope.canAccessMatter(actor(['billing_staff']), 'matter_public_id')).resolves.toBe(false);
    await expect(accessScope.assertCanAccessMatter(actor(['billing_staff']), 'matter_public_id')).rejects.toMatchObject({
      code: 'matter_scope_forbidden',
      statusCode: 403,
    });
  });

  it('defines active assignment and counsel-link predicates for future route enforcement', () => {
    const source = read('admin_backend/src/modules/access/scope.ts');

    for (const exportName of [
      'assertCanAccessClientAccount',
      'assertCanAccessMatter',
      'assertCanAccessDocument',
      'assertCanAccessMessageThread',
      'assertCanAccessEvent',
      'getScopedClientAccountIds',
      'getScopedMatterIds',
    ]) {
      expect(source).toContain(`export const ${exportName}`);
    }

    expect(source).toContain("hasRole(actor, 'ops_admin')");
    expect(source).toContain("hasRole(actor, 'billing_staff')");
    expect(source).toContain("hasRole(actor, 'case_staff')");
    expect(source).toContain("hasRole(actor, 'advocate')");
    expect(source).toContain('FROM matter_assignments ma');
    expect(source).toContain("ma.assignment_status_code = 'active'");
    expect(source).toContain('ma.removed_at IS NULL');
    expect(source).toContain('INNER JOIN staff_profiles sp');
    expect(source).toContain("sp.employment_status_code = 'active'");
    expect(source).toContain('INNER JOIN counsel_partner_users cpu');
    expect(source).toContain("cpu.relationship_status_code = 'active'");
    expect(source).toContain('cpu.archived_at IS NULL');
    expect(source).toContain("COALESCE(cp.partner_type_code, 'external_counsel') = 'external_counsel'");
    expect(source).toContain('FROM matter_documents md');
    expect(source).toContain('FROM conversation_threads ct');
    expect(source).toContain('FROM events e');
  });

  it('wires assigned-scope permissions into admin client, matter, document, message, and event routes', () => {
    const clientsRoute = read('admin_backend/src/routes/clients.ts');
    const mattersRoute = read('admin_backend/src/routes/matters.ts');
    const mattersService = read('admin_backend/src/modules/matters/service.ts');
    const documentsRoute = read('admin_backend/src/routes/documents.ts');
    const messagesRoute = read('admin_backend/src/routes/messages.ts');
    const eventsRoute = read('admin_backend/src/routes/events.ts');

    expect(clientsRoute).toContain('client_account.view_assigned');
    expect(clientsRoute).toContain('await listClients(actor');
    expect(clientsRoute).toContain('await getClientWorkspace(actor');

    expect(mattersRoute).toContain("'matter.view_assigned'");
    expect(mattersRoute).toContain("'matter.update_assigned'");
    expect(mattersRoute).toContain('await listMatters(actor');
    expect(mattersRoute).toContain('await getMatterWorkspace(actor');
    expect(mattersService).toContain('matter_assigned_update_field_forbidden');
    expect(mattersService).toContain('ASSIGNED_MATTER_DETAIL_UPDATE_FIELDS');

    expect(documentsRoute).toContain("'document.view_assigned'");
    expect(documentsRoute).toContain("'document.download_assigned'");
    expect(documentsRoute).toContain('await listDocuments(actor');
    expect(documentsRoute).toContain('await getDocumentDetail(actor');

    expect(messagesRoute).toContain("'message.view_assigned'");
    expect(messagesRoute).toContain("'message.send_assigned'");
    expect(messagesRoute).toContain('await getWorkspace(actor');

    expect(eventsRoute).toContain("'event.view_assigned'");
    expect(eventsRoute).toContain('await getWorkspace(actor');
  });

  it('applies scoped DB filters and per-record assertions in the service layer', () => {
    const shared = read('admin_backend/src/modules/shared.ts');
    const clientsService = read('admin_backend/src/modules/clients/service.ts');
    const mattersService = read('admin_backend/src/modules/matters/service.ts');
    const documentsService = read('admin_backend/src/modules/documents/service.ts');
    const messagesService = read('admin_backend/src/modules/messages/service.ts');
    const eventsService = read('admin_backend/src/modules/events/service.ts');

    expect(shared).toContain('clientAccountDbIds?: number[]');
    expect(shared).toContain('matterDbIds?: number[]');
    expect(shared).toContain('getAdminResponseVisibility');
    expect(shared).toContain("d.visibility_scope_code <> 'internal-only'");
    expect(shared).toContain('msg.visible_to_client = 1');
    expect(shared).toContain('e.client_visible_flag = 1');
    expect(shared).toContain("addOptionalInFilter(where, params, 'm.id', filters.matterDbIds)");
    expect(shared).toContain("addOptionalInFilter(where, params, 'ca.id', filters.clientAccountDbIds)");

    expect(clientsService).toContain("assignedPermission: 'client_account.view_assigned'");
    expect(clientsService).toContain('await assertCanAccessClientAccount(actor, clientAccountId)');
    expect(clientsService).toContain('matterDbIds: scopeFilters.matterDbIds');

    expect(mattersService).toContain("assignedPermission: 'matter.view_assigned'");
    expect(mattersService).toContain('await assertCanAccessMatter(actor, matterId');
    expect(mattersService).toContain("invoices: canViewBilling ? await fetchInvoices({ matterIds: [matterId] }) : []");

    expect(documentsService).toContain("assignedPermission: 'document.view_assigned'");
    expect(documentsService).toContain('await assertCanAccessDocument(actor, documentId');

    expect(messagesService).toContain("assignedPermission: 'message.view_assigned'");
    expect(messagesService).toContain('await assertCanAccessMatter(actor, payload.matterId)');
    expect(messagesService).toContain('await assertCanAccessMessageThread(actor, payload.threadId');

    expect(eventsService).toContain("assignedPermission: 'event.view_assigned'");
    expect(eventsService).toContain('matterDbIds: scopeFilters.matterDbIds');
  });
});
