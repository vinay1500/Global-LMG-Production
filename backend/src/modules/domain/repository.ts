import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { fromMysqlDateTime, nowUtc, toMysqlDateTime } from '../../lib/datetime.js';
import { createPublicId } from '../../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/httpErrors.js';
import { executeResult, selectAll, selectOne, withConnection, withTransaction } from '../../lib/mysqlUtils.js';
import { ensurePlatformReady } from '../platform/bootstrap.js';
import { domainEventService } from '../domainEvents/service.js';
import { getInvoicePaymentOptions } from '../payments/razorpayService.js';
import { allocateBusinessNumber } from '../platform/sequences.js';
import type {
  ClientAccountDetail,
  ClientAccountSummary,
  CounselPartnerDetail,
  CounselPartnerSummary,
  CreateEventInput,
  CreateMatterAssignmentInput,
  CreateRefundInput,
  DocumentDetail,
  DocumentSummary,
  EventDetail,
  EventSummary,
  InvoiceDetail,
  InvoiceSummary,
  MatterDetail,
  MatterSummary,
  PaymentSummary,
  PermissionSummary,
  RefundSummary,
  ReplaceUserRolesInput,
  RoleSummary,
  UpdateMatterStageInput,
  UserRoleSummary,
} from './types.js';

interface ClientAccountRow extends RowDataPacket {
  account_status_code: string;
  client_code: string;
  client_type_code: string;
  display_name: string;
  legal_name: string;
  onboarding_status_code: string;
  owner_user_public_id: string | null;
  primary_email: string;
  primary_phone: string;
  public_id: string;
}

interface ClientAccountIdRow extends RowDataPacket {
  client_account_id: number;
}

interface CurrentClientAccountAccessRow extends RowDataPacket {
  client_account_id: number;
}

interface ClientContactRow extends RowDataPacket {
  contact_role_code: string;
  display_name: string;
  email: string;
  is_billing: number;
  is_primary: number;
  phone: string | null;
  portal_access_enabled: number;
  public_id: string;
}

interface ClientAddressRow extends RowDataPacket {
  address_type_code: string;
  city: string;
  country_code: string;
  id: number;
  is_primary: number;
  line1: string;
  line2: string | null;
  postal_code: string;
  state: string;
}

interface CountRow extends RowDataPacket {
  count: number | string;
}

interface MatterRow extends RowDataPacket {
  client_account_public_id: string;
  client_display_name: string;
  consultation_mode_code: string;
  current_stage_code: string;
  current_stage_label: string;
  detailed_description: string | null;
  due_total_amount: number | string;
  issue_summary: string;
  last_activity_at: string | Date;
  legal_domain_name: string;
  matter_number: string;
  opened_at: string | Date;
  operational_status_code: string;
  paid_total_amount: number | string;
  priority_code: string;
  public_id: string;
  quoted_total_amount: number | string;
  refunded_total_amount: number | string;
  title: string;
  urgency_code: string;
}

interface MatterServiceRow extends RowDataPacket {
  completed_at: string | Date | null;
  final_fee: number | string;
  service_code: string;
  service_name: string;
  service_status_code: string;
}

interface MatterAssignmentRow extends RowDataPacket {
  assigned_at: string | Date;
  assigned_by_user_public_id: string;
  assigned_name: string;
  assignment_role_code: string;
  assignment_status_code: string;
  counsel_partner_public_id: string | null;
  fee_agreed_amount: number | string | null;
  fee_due_amount: number | string | null;
  fee_paid_amount: number | string | null;
  id: number;
  internal_user_public_id: string | null;
  is_primary: number;
  removed_at: string | Date | null;
}

interface MatterStageHistoryRow extends RowDataPacket {
  changed_by_user_public_id: string | null;
  change_note: string | null;
  entered_at: string | Date;
  exited_at: string | Date | null;
  stage_code: string;
  stage_label: string;
  visible_to_client: number;
}

interface MatterUpdateRow extends RowDataPacket {
  body_text: string;
  created_at: string | Date;
  created_by_user_public_id: string | null;
  edited_at: string | Date | null;
  id: number;
  title: string;
  update_type_code: string;
  visible_to_client: number;
}

interface MatterDocumentRow extends RowDataPacket {
  category_code: string;
  document_number: string;
  document_public_id: string;
  original_file_name: string | null;
  title: string;
  visibility_scope_code: string;
}

interface DocumentRow extends RowDataPacket {
  category_code: string;
  current_version_no: number;
  document_number: string;
  owner_client_account_public_id: string;
  public_id: string;
  title: string;
  visibility_scope_code: string;
}

interface DocumentVersionRow extends RowDataPacket {
  checksum_sha256: string;
  file_extension: string;
  file_size_bytes: number | string;
  is_current: number;
  mime_type: string;
  original_file_name: string;
  public_id: string;
  retention_hold_flag: number;
  uploaded_at: string | Date;
  uploaded_by_user_public_id: string;
  version_no: number;
  virus_scan_status_code: string;
}

interface DocumentDownloadRow extends RowDataPacket {
  document_version_public_id: string;
  downloaded_at: string | Date;
  downloaded_by_user_public_id: string;
  id: number;
}

interface LinkedEntityRow extends RowDataPacket {
  entity_public_id: string;
  label: string;
  type_code: 'invoice' | 'matter' | 'request';
}

interface EventRow extends RowDataPacket {
  cancelled_at: string | Date | null;
  cancelled_by_user_public_id: string | null;
  client_account_public_id: string;
  client_visible_flag: number;
  host_url: string | null;
  join_url: string | null;
  location_text: string | null;
  matter_public_id: string | null;
  matter_title: string | null;
  meeting_provider_code: string;
  mode_code: string;
  notes: string | null;
  public_id: string;
  scheduled_end_at: string | Date;
  scheduled_start_at: string | Date;
  status_code: string;
  timezone_name: string;
  title: string;
  type_code: string;
}

interface EventParticipantRow extends RowDataPacket {
  attendance_status_code: string;
  client_contact_user_public_id: string | null;
  counsel_partner_public_id: string | null;
  display_name: string;
  id: number;
  internal_user_public_id: string | null;
  joined_at: string | Date | null;
  left_at: string | Date | null;
  participant_role_code: string;
  rsvp_status_code: string;
}

interface InvoiceRow extends RowDataPacket {
  amount_due: number | string;
  amount_paid: number | string;
  amount_refunded: number | string;
  business_address_snapshot: string | null;
  business_email_snapshot: string | null;
  business_gstin_snapshot: string | null;
  business_name_snapshot: string | null;
  business_phone_snapshot: string | null;
  business_state_snapshot: string | null;
  business_website_snapshot: string | null;
  client_account_public_id: string;
  created_at: string | Date;
  currency_code: string;
  discount_amount: number | string;
  due_date: string;
  issue_date: string;
  matter_public_id: string | null;
  public_id: string;
  rendered_body_snapshot: string | null;
  rendered_footer_snapshot: string | null;
  rendered_subject_snapshot: string | null;
  rendered_terms_snapshot: string | null;
  status_code: string;
  subtotal_amount: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  invoice_number: string;
  invoice_type_code: string;
  payment_instructions_snapshot: string | null;
  template_public_id_snapshot: string | null;
  template_version_snapshot: number | null;
}

interface BillingSnapshotRow extends RowDataPacket {
  address_line1: string;
  address_line2: string | null;
  billing_email: string;
  billing_name: string;
  billing_phone: string;
  city: string;
  country_code: string;
  gstin: string | null;
  postal_code: string;
  state: string;
}

interface InvoiceLineRow extends RowDataPacket {
  description: string;
  discount_amount: number | string;
  id: number;
  line_subtotal: number | string;
  line_total: number | string;
  quantity: number | string;
  service_public_id: string | null;
  sort_order: number;
  subscription_plan_id: number | null;
  taxable_amount: number | string;
  type_code: string;
  unit_price: number | string;
}

interface InvoiceLineTaxRow extends RowDataPacket {
  id: number;
  invoice_line_id: number;
  tax_amount: number | string;
  tax_code_snapshot: string;
  tax_name_snapshot: string;
  tax_percent_snapshot: number | string;
}

interface InvoiceInstallmentRow extends RowDataPacket {
  amount_due: number | string;
  amount_paid: number | string;
  amount_remaining: number | string;
  due_date: string;
  id: number;
  installment_no: number;
  paid_at: string | Date | null;
  status_code: string;
}

interface PaymentRow extends RowDataPacket {
  client_account_public_id: string;
  created_by_user_public_id: string | null;
  currency_code: string;
  gateway_order_ref: string | null;
  gateway_payment_ref: string | null;
  gateway_provider_code: string;
  gross_amount: number | string;
  invoice_public_id: string | null;
  net_amount: number | string;
  public_id: string;
  initiated_at: string | Date;
  status_code: string;
}

interface RefundRow extends RowDataPacket {
  amount: number | string;
  approved_by_user_public_id: string | null;
  completed_at: string | Date | null;
  invoice_public_id: string | null;
  payment_public_id: string;
  public_id: string;
  reason_text: string;
  refund_status_code: string;
  requested_at: string | Date;
  requested_by_user_public_id: string;
}

interface CounselPartnerRow extends RowDataPacket {
  availability_status_code: string;
  bar_registration_number: string | null;
  counsel_code: string;
  country_code: string;
  email: string;
  full_name: string;
  invited_user_public_id: string | null;
  organization_name: string | null;
  partner_status_code: string;
  phone: string;
  primary_jurisdiction: string;
  public_id: string;
  city: string;
  state: string;
  years_experience: number;
}

interface CounselExpertiseRow extends RowDataPacket {
  domain_code: string;
  domain_name: string;
  proficiency_level_code: string;
  service_code: string | null;
  service_name: string | null;
  years_experience: number;
}

interface RoleRow extends RowDataPacket {
  code: string;
  description: string | null;
  is_active: number;
  is_system: number;
  name: string;
}

interface PermissionRow extends RowDataPacket {
  action_name: string;
  code: string;
  description: string | null;
  module_name: string;
}

interface UserRoleRow extends RowDataPacket {
  account_status_code: string;
  actor_type_code: string;
  display_name: string;
  email: string;
  public_id: string;
  role_codes: string | null;
}

const toNumber = (value: number | string | null | undefined) => Number(value || 0);
const toIso = (value: string | Date | null | undefined) => fromMysqlDateTime(value) || '';

const mapMatterSummary = (row: MatterRow): MatterSummary => ({
  clientAccountId: row.client_account_public_id,
  clientName: row.client_display_name,
  consultationModeCode: row.consultation_mode_code,
  currentStageCode: row.current_stage_code,
  currentStageLabel: row.current_stage_label,
  id: row.public_id,
  issueSummary: row.issue_summary,
  lastActivityAt: toIso(row.last_activity_at),
  legalDomainName: row.legal_domain_name,
  matterNumber: row.matter_number,
  openedAt: toIso(row.opened_at),
  operationalStatusCode: row.operational_status_code,
  priorityCode: row.priority_code,
  title: row.title,
  totals: {
    due: toNumber(row.due_total_amount),
    paid: toNumber(row.paid_total_amount),
    quoted: toNumber(row.quoted_total_amount),
    refunded: toNumber(row.refunded_total_amount),
  },
  urgencyCode: row.urgency_code,
});

const mapDocumentVersion = (row: DocumentVersionRow) => ({
  checksumSha256: row.checksum_sha256,
  fileExtension: row.file_extension,
  fileSizeBytes: toNumber(row.file_size_bytes),
  id: row.public_id,
  isCurrent: Boolean(row.is_current),
  mimeType: row.mime_type,
  originalFileName: row.original_file_name,
  retentionHoldFlag: Boolean(row.retention_hold_flag),
  uploadedAt: toIso(row.uploaded_at),
  uploadedByUserId: row.uploaded_by_user_public_id,
  versionNo: row.version_no,
  virusScanStatusCode: row.virus_scan_status_code,
});

export class DomainRepository {
  public constructor(private readonly pool: Pool) {}

  public async initialize() {
    await ensurePlatformReady();
  }

  private async resolveClientAccountId(connection: PoolConnection, clientAccountPublicId: string) {
    const row = await selectOne<ClientAccountIdRow>(
      connection,
      'SELECT id AS client_account_id FROM client_accounts WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
      [clientAccountPublicId]
    );

    if (!row?.client_account_id) {
      throw notFound('client_account_not_found', 'Client account not found.');
    }

    return Number(row.client_account_id);
  }

  private async resolveMatterId(connection: PoolConnection, matterPublicId: string) {
    const row = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM matters WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
      [matterPublicId]
    );

    if (!row?.id) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    return Number(row.id);
  }

  private async resolveUserId(connection: PoolConnection, userPublicId: string) {
    const row = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM users WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
      [userPublicId]
    );

    if (!row?.id) {
      throw notFound('user_not_found', 'User not found.');
    }

    return Number(row.id);
  }

  private async resolveCounselId(connection: PoolConnection, counselPublicId: string) {
    const row = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM counsel_partners WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
      [counselPublicId]
    );

    if (!row?.id) {
      throw notFound('counsel_partner_not_found', 'Counsel partner not found.');
    }

    return Number(row.id);
  }

  private async resolveInvoiceId(connection: PoolConnection, invoicePublicId: string) {
    const row = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM invoices WHERE public_id = ? AND archived_at IS NULL LIMIT 1',
      [invoicePublicId]
    );

    if (!row?.id) {
      throw notFound('invoice_not_found', 'Invoice not found.');
    }

    return Number(row.id);
  }

  private async resolvePaymentId(connection: PoolConnection, paymentPublicId: string) {
    const row = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM payment_transactions WHERE public_id = ? LIMIT 1',
      [paymentPublicId]
    );

    if (!row?.id) {
      throw notFound('payment_not_found', 'Payment not found.');
    }

    return Number(row.id);
  }

  public async getMyClientAccount(userPublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) => {
      const account = await selectOne<ClientAccountRow>(
        connection,
        `SELECT
           ca.public_id,
           ca.client_code,
           ca.client_type_code,
           ca.legal_name,
           ca.display_name,
           ca.primary_email,
           ca.primary_phone,
           ca.onboarding_status_code,
           ca.account_status_code,
           owner.public_id AS owner_user_public_id
         FROM client_account_contacts cac
         INNER JOIN client_accounts ca
           ON ca.id = cac.client_account_id
           AND ca.archived_at IS NULL
         LEFT JOIN users owner
           ON owner.id = ca.owner_user_id
         INNER JOIN users u
           ON u.id = cac.user_id
         WHERE u.public_id = ?
           AND cac.archived_at IS NULL
         LIMIT 1`,
        [userPublicId]
      );

      if (!account) {
        throw notFound('client_account_not_found', 'Client account not found for the current user.');
      }

      return this.getClientAccountByPublicIdInternal(connection, account.public_id);
    });
  }

  public async listClientMatters(clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.listMattersInternal(connection, clientAccountId)
    );
  }

  public async getClientMatter(clientAccountId: number, matterPublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.getMatterInternal(connection, matterPublicId, clientAccountId)
    );
  }

  public async listClientDocuments(clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.listDocumentsInternal(connection, clientAccountId)
    );
  }

  public async getClientDocument(clientAccountId: number, documentPublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.getDocumentInternal(connection, documentPublicId, clientAccountId)
    );
  }

  public async listClientEvents(clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.listEventsInternal(connection, clientAccountId)
    );
  }

  public async listClientInvoices(clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.listInvoicesInternal(connection, clientAccountId)
    );
  }

  public async getClientInvoice(clientAccountId: number, invoicePublicId: string) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.getInvoiceInternal(connection, invoicePublicId, clientAccountId)
    );
  }

  public async listClientPayments(clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.listPaymentsInternal(connection, clientAccountId)
    );
  }

  public async listClientRefunds(clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.listRefundsInternal(connection, clientAccountId)
    );
  }

  public async assertCurrentClientAccountAccess(userPublicId: string, clientAccountId: number) {
    await this.initialize();

    return withConnection(this.pool, async (connection) =>
      this.assertCurrentClientAccountAccessInternal(connection, userPublicId, clientAccountId)
    );
  }

  private async assertCurrentClientAccountAccessInternal(
    connection: PoolConnection,
    userPublicId: string,
    clientAccountId: number
  ) {
    const access = await selectOne<CurrentClientAccountAccessRow>(
      connection,
      `SELECT ca.id AS client_account_id
       FROM users u
       INNER JOIN user_roles ur
         ON ur.user_id = u.id
        AND ur.role_code = 'client'
        AND ur.is_active = 1
        AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
        AND (ur.ends_at IS NULL OR ur.ends_at > UTC_TIMESTAMP(6))
       INNER JOIN client_account_contacts cac
         ON cac.user_id = u.id
        AND cac.client_account_id = ?
        AND cac.portal_access_enabled = 1
        AND cac.archived_at IS NULL
       INNER JOIN client_accounts ca
         ON ca.id = cac.client_account_id
        AND ca.archived_at IS NULL
       WHERE u.public_id = ?
         AND u.actor_type_code = 'client'
         AND u.login_enabled = 1
         AND u.archived_at IS NULL
       LIMIT 1`,
      [clientAccountId, userPublicId]
    );

    if (!access) {
      throw forbidden('client_account_access_revoked', 'You do not have access to this client account.');
    }

    return Number(access.client_account_id);
  }


  private async getClientAccountByPublicIdInternal(
    connection: PoolConnection,
    clientAccountPublicId: string
  ) {
    const account = await selectOne<ClientAccountRow>(
      connection,
      `SELECT
         ca.public_id,
         ca.client_code,
         ca.client_type_code,
         ca.legal_name,
         ca.display_name,
         ca.primary_email,
         ca.primary_phone,
         ca.onboarding_status_code,
         ca.account_status_code,
         owner.public_id AS owner_user_public_id
       FROM client_accounts ca
       LEFT JOIN users owner
         ON owner.id = ca.owner_user_id
       WHERE ca.public_id = ?
         AND ca.archived_at IS NULL
       LIMIT 1`,
      [clientAccountPublicId]
    );

    if (!account) {
      throw notFound('client_account_not_found', 'Client account not found.');
    }

    const contacts = await selectAll<ClientContactRow>(
      connection,
      `SELECT
         u.public_id,
         u.display_name,
         u.email,
         u.phone,
         cac.contact_role_code,
         cac.is_primary,
         cac.is_billing,
         cac.portal_access_enabled
       FROM client_account_contacts cac
       INNER JOIN users u
         ON u.id = cac.user_id
       INNER JOIN client_accounts ca
         ON ca.id = cac.client_account_id
       WHERE ca.public_id = ?
         AND cac.archived_at IS NULL
       ORDER BY cac.is_primary DESC, u.display_name ASC`,
      [clientAccountPublicId]
    );

    const addresses = await selectAll<ClientAddressRow>(
      connection,
      `SELECT
         id, address_type_code, line1, line2, city, state, postal_code, country_code, is_primary
       FROM client_addresses
       WHERE client_account_id = (
         SELECT id FROM client_accounts WHERE public_id = ? LIMIT 1
       )
         AND archived_at IS NULL
       ORDER BY is_primary DESC, id ASC`,
      [clientAccountPublicId]
    );

    const matterCount = await selectOne<CountRow>(
      connection,
      `SELECT COUNT(*) AS count
       FROM matters
       WHERE client_account_id = (
         SELECT id FROM client_accounts WHERE public_id = ? LIMIT 1
       )
         AND archived_at IS NULL`,
      [clientAccountPublicId]
    );

    return {
      accountStatusCode: account.account_status_code,
      addresses: addresses.map((row) => ({
        addressTypeCode: row.address_type_code,
        city: row.city,
        countryCode: row.country_code,
        id: row.id,
        isPrimary: Boolean(row.is_primary),
        line1: row.line1,
        line2: row.line2,
        postalCode: row.postal_code,
        state: row.state,
      })),
      clientCode: account.client_code,
      clientTypeCode: account.client_type_code,
      contacts: contacts.map((row) => ({
        contactRoleCode: row.contact_role_code,
        email: row.email,
        id: row.public_id,
        isBilling: Boolean(row.is_billing),
        isPrimary: Boolean(row.is_primary),
        name: row.display_name,
        phone: row.phone,
        portalAccessEnabled: Boolean(row.portal_access_enabled),
      })),
      displayName: account.display_name,
      id: account.public_id,
      legalName: account.legal_name,
      matterCount: Number(matterCount?.count || 0),
      onboardingStatusCode: account.onboarding_status_code,
      ownerUserId: account.owner_user_public_id,
      primaryEmail: account.primary_email,
      primaryPhone: account.primary_phone,
    } satisfies ClientAccountDetail;
  }

  private async listMattersInternal(connection: PoolConnection, clientAccountId?: number) {
    const rows = await selectAll<MatterRow>(
      connection,
      `SELECT
         m.public_id,
         m.matter_number,
         m.title,
         m.issue_summary,
         m.detailed_description,
         ld.domain_name AS legal_domain_name,
         ca.public_id AS client_account_public_id,
         ca.display_name AS client_display_name,
         m.current_stage_code,
         ms.label AS current_stage_label,
         m.operational_status_code,
         m.consultation_mode_code,
         pur.urgency_code,
         m.priority_code,
         m.quoted_total_amount,
         m.paid_total_amount,
         m.refunded_total_amount,
         m.due_total_amount,
         m.opened_at,
         m.last_activity_at
       FROM matters m
       INNER JOIN client_accounts ca
         ON ca.id = m.client_account_id
       INNER JOIN legal_domains ld
         ON ld.id = m.legal_domain_id
       INNER JOIN matter_stages ms
         ON ms.code = m.current_stage_code
       INNER JOIN pricing_urgency_rules pur
         ON pur.id = m.urgency_rule_id
       WHERE m.archived_at IS NULL
         ${clientAccountId ? 'AND m.client_account_id = ?' : ''}
       ORDER BY m.last_activity_at DESC`,
      clientAccountId ? [clientAccountId] : []
    );

    return rows.map(mapMatterSummary) satisfies MatterSummary[];
  }

  private async getMatterInternal(
    connection: PoolConnection,
    matterPublicId: string,
    clientAccountId?: number
  ) {
    const row = await selectOne<MatterRow>(
      connection,
      `SELECT
         m.public_id,
         m.matter_number,
         m.title,
         m.issue_summary,
         m.detailed_description,
         ld.domain_name AS legal_domain_name,
         ca.public_id AS client_account_public_id,
         ca.display_name AS client_display_name,
         m.current_stage_code,
         ms.label AS current_stage_label,
         m.operational_status_code,
         m.consultation_mode_code,
         pur.urgency_code,
         m.priority_code,
         m.quoted_total_amount,
         m.paid_total_amount,
         m.refunded_total_amount,
         m.due_total_amount,
         m.opened_at,
         m.last_activity_at
       FROM matters m
       INNER JOIN client_accounts ca
         ON ca.id = m.client_account_id
       INNER JOIN legal_domains ld
         ON ld.id = m.legal_domain_id
       INNER JOIN matter_stages ms
         ON ms.code = m.current_stage_code
       INNER JOIN pricing_urgency_rules pur
         ON pur.id = m.urgency_rule_id
       WHERE m.public_id = ?
         AND m.archived_at IS NULL
         ${clientAccountId ? 'AND m.client_account_id = ?' : ''}
       LIMIT 1`,
      clientAccountId ? [matterPublicId, clientAccountId] : [matterPublicId]
    );

    if (!row) {
      throw notFound('matter_not_found', 'Matter not found.');
    }

    const services = await selectAll<MatterServiceRow>(
      connection,
      `SELECT
         s.service_code,
         s.service_name,
         ms.final_fee,
         ms.service_status_code,
         ms.completed_at
       FROM matter_services ms
       INNER JOIN services s
         ON s.id = ms.service_id
       INNER JOIN matters m
         ON m.id = ms.matter_id
       WHERE m.public_id = ?
       ORDER BY s.sort_order ASC`,
      [matterPublicId]
    );

    const assignments = await selectAll<MatterAssignmentRow>(
      connection,
      `SELECT
         ma.id,
         ma.assignment_role_code,
         ma.is_primary,
         ma.fee_agreed_amount,
         ma.fee_paid_amount,
         ma.fee_due_amount,
         ma.assigned_at,
         ma.removed_at,
         ma.assignment_status_code,
         internal_user.public_id AS internal_user_public_id,
         counsel.public_id AS counsel_partner_public_id,
         assigned_by.public_id AS assigned_by_user_public_id,
         COALESCE(internal_user.display_name, counsel.full_name) AS assigned_name
       FROM matter_assignments ma
       LEFT JOIN users internal_user
         ON internal_user.id = ma.internal_user_id
       LEFT JOIN counsel_partners counsel
         ON counsel.id = ma.counsel_partner_id
       INNER JOIN users assigned_by
         ON assigned_by.id = ma.assigned_by_user_id
       INNER JOIN matters m
         ON m.id = ma.matter_id
       WHERE m.public_id = ?
       ORDER BY ma.assigned_at DESC`,
      [matterPublicId]
    );

    const stageHistory = await selectAll<MatterStageHistoryRow>(
      connection,
      `SELECT
         msh.stage_code,
         ms.label AS stage_label,
         msh.entered_at,
         msh.exited_at,
         msh.change_note,
         msh.visible_to_client,
         changed_by.public_id AS changed_by_user_public_id
       FROM matter_stage_history msh
       INNER JOIN matter_stages ms
         ON ms.code = msh.stage_code
       INNER JOIN matters m
         ON m.id = msh.matter_id
       LEFT JOIN users changed_by
         ON changed_by.id = msh.changed_by_user_id
       WHERE m.public_id = ?
       ORDER BY msh.entered_at ASC`,
      [matterPublicId]
    );

    const updates = await selectAll<MatterUpdateRow>(
      connection,
      `SELECT
         mu.id,
         mu.update_type_code,
         mu.title,
         mu.body_text,
         mu.visible_to_client,
         mu.created_at,
         mu.edited_at,
         created_by.public_id AS created_by_user_public_id
       FROM matter_updates mu
       INNER JOIN matters m
         ON m.id = mu.matter_id
       LEFT JOIN users created_by
         ON created_by.id = mu.created_by_user_id
       WHERE m.public_id = ?
       ORDER BY mu.created_at DESC`,
      [matterPublicId]
    );

    const documents = await selectAll<MatterDocumentRow>(
      connection,
      `SELECT
         d.public_id AS document_public_id,
         d.document_number,
         d.title,
         d.category_code,
         d.visibility_scope_code,
         dv.original_file_name
       FROM matter_documents md
       INNER JOIN matters m
         ON m.id = md.matter_id
       INNER JOIN documents d
         ON d.id = md.document_id
       LEFT JOIN document_versions dv
         ON dv.document_id = d.id
         AND dv.is_current = 1
       WHERE m.public_id = ?
       ORDER BY d.created_at DESC`,
      [matterPublicId]
    );

    return {
      ...mapMatterSummary(row),
      assignments: assignments.map((entry) => ({
        assignedAt: toIso(entry.assigned_at),
        assignedByUserId: entry.assigned_by_user_public_id,
        assigneeId: entry.internal_user_public_id || entry.counsel_partner_public_id || '',
        assigneeName: entry.assigned_name,
        assigneeType: entry.internal_user_public_id ? 'internal_user' : 'counsel_partner',
        assignmentRoleCode: entry.assignment_role_code,
        assignmentStatusCode: entry.assignment_status_code,
        feeAgreedAmount: entry.fee_agreed_amount === null ? null : toNumber(entry.fee_agreed_amount),
        feeDueAmount: entry.fee_due_amount === null ? null : toNumber(entry.fee_due_amount),
        feePaidAmount: entry.fee_paid_amount === null ? null : toNumber(entry.fee_paid_amount),
        id: entry.id,
        isPrimary: Boolean(entry.is_primary),
        removedAt: entry.removed_at ? toIso(entry.removed_at) : null,
      })),
      description: row.detailed_description,
      documents: documents.map((entry) => ({
        categoryCode: entry.category_code,
        documentNumber: entry.document_number,
        id: entry.document_public_id,
        latestFileName: entry.original_file_name || '',
        title: entry.title,
        visibilityScopeCode: entry.visibility_scope_code,
      })),
      services: services.map((entry) => ({
        completedAt: entry.completed_at ? toIso(entry.completed_at) : null,
        fee: toNumber(entry.final_fee),
        name: entry.service_name,
        serviceCode: entry.service_code,
        statusCode: entry.service_status_code,
      })),
      stageHistory: stageHistory.map((entry) => ({
        changedByUserId: entry.changed_by_user_public_id,
        changeNote: entry.change_note,
        enteredAt: toIso(entry.entered_at),
        exitedAt: entry.exited_at ? toIso(entry.exited_at) : null,
        label: entry.stage_label,
        stageCode: entry.stage_code,
        visibleToClient: Boolean(entry.visible_to_client),
      })),
      updates: updates.map((entry) => ({
        bodyText: entry.body_text,
        createdAt: toIso(entry.created_at),
        createdByUserId: entry.created_by_user_public_id,
        editedAt: entry.edited_at ? toIso(entry.edited_at) : null,
        id: entry.id,
        title: entry.title,
        typeCode: entry.update_type_code,
        visibleToClient: Boolean(entry.visible_to_client),
      })),
    } satisfies MatterDetail;
  }

  private async listDocumentsInternal(connection: PoolConnection, clientAccountId?: number) {
    const rows = await selectAll<DocumentRow>(
      connection,
      `SELECT
         d.public_id,
         d.document_number,
         d.owner_client_account_id,
         owner.public_id AS owner_client_account_public_id,
         d.title,
         d.category_code,
         d.visibility_scope_code,
         d.current_version_no
      FROM documents d
      INNER JOIN client_accounts owner
        ON owner.id = d.owner_client_account_id
      WHERE d.archived_at IS NULL
         ${clientAccountId ? 'AND d.owner_client_account_id = ?' : ''}
         ${clientAccountId ? "AND d.visibility_scope_code IN ('client', 'client-portal', 'shared')" : ''}
      ORDER BY d.updated_at DESC`,
      clientAccountId ? [clientAccountId] : []
    );

    const documentIds = rows.map((row) => row.public_id);
    const versionRows = documentIds.length
      ? await selectAll<DocumentVersionRow>(
          connection,
          `SELECT
             d.public_id AS document_public_id,
             dv.public_id,
             dv.version_no,
             dv.original_file_name,
             dv.mime_type,
             dv.file_extension,
             dv.file_size_bytes,
             dv.checksum_sha256,
             dv.virus_scan_status_code,
             dv.uploaded_at,
             uploader.public_id AS uploaded_by_user_public_id,
             dv.is_current,
             dv.retention_hold_flag
           FROM document_versions dv
           INNER JOIN documents d
             ON d.id = dv.document_id
           INNER JOIN users uploader
             ON uploader.id = dv.uploaded_by_user_id
           WHERE d.public_id IN (${documentIds.map(() => '?').join(', ')})
             AND dv.is_current = 1`,
          documentIds
        )
      : [];

    const versionMap = new Map<string, DocumentVersionRow>();
    for (const row of versionRows as Array<DocumentVersionRow & { document_public_id: string }>) {
      versionMap.set((row as DocumentVersionRow & { document_public_id: string }).document_public_id, row);
    }

    return rows.map((row) => ({
      categoryCode: row.category_code,
      currentVersionNo: row.current_version_no,
      id: row.public_id,
      latestVersion: versionMap.get(row.public_id) ? mapDocumentVersion(versionMap.get(row.public_id)!) : null,
      ownerClientAccountId: row.owner_client_account_public_id,
      title: row.title,
      visibilityScopeCode: row.visibility_scope_code,
    })) satisfies DocumentSummary[];
  }

  private async getDocumentInternal(
    connection: PoolConnection,
    documentPublicId: string,
    clientAccountId?: number
  ) {
    const row = await selectOne<DocumentRow>(
      connection,
      `SELECT
         d.public_id,
         d.document_number,
         d.owner_client_account_id,
         owner.public_id AS owner_client_account_public_id,
         d.title,
         d.category_code,
         d.visibility_scope_code,
         d.current_version_no
       FROM documents d
       INNER JOIN client_accounts owner
         ON owner.id = d.owner_client_account_id
      WHERE d.public_id = ?
        AND d.archived_at IS NULL
        ${clientAccountId ? 'AND d.owner_client_account_id = ?' : ''}
        ${clientAccountId ? "AND d.visibility_scope_code IN ('client', 'client-portal', 'shared')" : ''}
      LIMIT 1`,
      clientAccountId ? [documentPublicId, clientAccountId] : [documentPublicId]
    );

    if (!row) {
      throw notFound('document_not_found', 'Document not found.');
    }

    const versions = await selectAll<DocumentVersionRow>(
      connection,
      `SELECT
         dv.public_id,
         dv.version_no,
         dv.original_file_name,
         dv.mime_type,
         dv.file_extension,
         dv.file_size_bytes,
         dv.checksum_sha256,
         dv.virus_scan_status_code,
         dv.uploaded_at,
         uploader.public_id AS uploaded_by_user_public_id,
         dv.is_current,
         dv.retention_hold_flag
       FROM document_versions dv
       INNER JOIN documents d
         ON d.id = dv.document_id
       INNER JOIN users uploader
         ON uploader.id = dv.uploaded_by_user_id
       WHERE d.public_id = ?
       ORDER BY dv.version_no DESC`,
      [documentPublicId]
    );

    const downloads = await selectAll<DocumentDownloadRow>(
      connection,
      `SELECT
         ddl.id,
         ddl.downloaded_at,
         downloader.public_id AS downloaded_by_user_public_id,
         dv.public_id AS document_version_public_id
       FROM document_download_logs ddl
       INNER JOIN documents d
         ON d.id = ddl.document_id
       INNER JOIN document_versions dv
         ON dv.id = ddl.document_version_id
       INNER JOIN users downloader
         ON downloader.id = ddl.downloaded_by_user_id
       WHERE d.public_id = ?
       ORDER BY ddl.downloaded_at DESC`,
      [documentPublicId]
    );

    const linkedEntities = await selectAll<LinkedEntityRow>(
      connection,
      `SELECT
         'matter' AS type_code,
         m.public_id AS entity_public_id,
         m.title AS label
       FROM matter_documents md
       INNER JOIN matters m
         ON m.id = md.matter_id
       INNER JOIN documents d
         ON d.id = md.document_id
       WHERE d.public_id = ?
       UNION ALL
       SELECT
         'request' AS type_code,
         sr.public_id AS entity_public_id,
         sr.title AS label
       FROM request_documents rd
       INNER JOIN service_requests sr
         ON sr.id = rd.service_request_id
       INNER JOIN documents d
         ON d.id = rd.document_id
       WHERE d.public_id = ?
       UNION ALL
       SELECT
         'invoice' AS type_code,
         i.public_id AS entity_public_id,
         i.invoice_number AS label
       FROM invoice_documents idoc
       INNER JOIN invoices i
         ON i.id = idoc.invoice_id
       INNER JOIN documents d
         ON d.id = idoc.document_id
       WHERE d.public_id = ?`,
      [documentPublicId, documentPublicId, documentPublicId]
    );

    return {
      categoryCode: row.category_code,
      currentVersionNo: row.current_version_no,
      documentNumber: row.document_number,
      downloads: downloads.map((entry) => ({
        downloadedAt: toIso(entry.downloaded_at),
        downloadedByUserId: entry.downloaded_by_user_public_id,
        id: entry.id,
        versionId: entry.document_version_public_id,
      })),
      id: row.public_id,
      latestVersion: versions[0] ? mapDocumentVersion(versions[0]) : null,
      linkedEntities: linkedEntities.map((entry) => ({
        id: entry.entity_public_id,
        label: entry.label,
        type: entry.type_code,
      })),
      ownerClientAccountId: row.owner_client_account_public_id,
      title: row.title,
      versions: versions.map(mapDocumentVersion),
      visibilityScopeCode: row.visibility_scope_code,
    } satisfies DocumentDetail;
  }

  private async listEventsInternal(connection: PoolConnection, clientAccountId?: number) {
    const rows = await selectAll<EventRow>(
      connection,
      `SELECT
         e.public_id,
         ca.public_id AS client_account_public_id,
         e.title,
         e.event_type_code AS type_code,
         e.status_code,
         e.scheduled_start_at,
         e.scheduled_end_at,
         e.timezone_name,
         e.mode_code,
         e.location_text,
         e.meeting_provider_code,
         e.join_url,
         e.host_url,
         e.client_visible_flag,
         e.notes,
         e.cancelled_at,
         cancelled_by.public_id AS cancelled_by_user_public_id,
         m.public_id AS matter_public_id,
         m.title AS matter_title
       FROM events e
       INNER JOIN client_accounts ca
         ON ca.id = e.client_account_id
       LEFT JOIN matters m
         ON m.id = e.matter_id
       LEFT JOIN users cancelled_by
         ON cancelled_by.id = e.cancelled_by_user_id
       WHERE 1 = 1
         ${clientAccountId ? 'AND e.client_account_id = ?' : ''}
         ${clientAccountId ? 'AND e.client_visible_flag = 1' : ''}
       ORDER BY e.scheduled_start_at DESC`,
      clientAccountId ? [clientAccountId] : []
    );

    return rows.map((row) => ({
      clientAccountId: row.client_account_public_id,
      clientVisibleFlag: Boolean(row.client_visible_flag),
      id: row.public_id,
      locationText: row.location_text,
      matterId: row.matter_public_id,
      matterTitle: row.matter_title,
      meetingProviderCode: row.meeting_provider_code,
      modeCode: row.mode_code,
      scheduledEndAt: toIso(row.scheduled_end_at),
      scheduledStartAt: toIso(row.scheduled_start_at),
      statusCode: row.status_code,
      timezoneName: row.timezone_name,
      title: row.title,
      typeCode: row.type_code,
    })) satisfies EventSummary[];
  }

  private async listInvoicesInternal(connection: PoolConnection, clientAccountId?: number) {
    const rows = await selectAll<InvoiceRow>(
      connection,
      `SELECT
         i.public_id,
         i.invoice_number,
         client.public_id AS client_account_public_id,
         matter.public_id AS matter_public_id,
         i.invoice_type_code,
         i.status_code,
         i.currency_code,
         i.issue_date,
         i.due_date,
         i.subtotal_amount,
         i.discount_amount,
         i.tax_amount,
         i.total_amount,
         i.amount_paid,
         i.amount_refunded,
         i.amount_due,
         i.template_public_id_snapshot,
         i.template_version_snapshot,
         i.rendered_subject_snapshot,
         i.rendered_body_snapshot,
         i.rendered_terms_snapshot,
         i.rendered_footer_snapshot,
         i.business_name_snapshot,
         i.business_address_snapshot,
         i.business_phone_snapshot,
         i.business_email_snapshot,
         i.business_website_snapshot,
         i.business_gstin_snapshot,
         i.business_state_snapshot,
         i.payment_instructions_snapshot,
         i.created_at
       FROM invoices i
       INNER JOIN client_accounts client
         ON client.id = i.client_account_id
       LEFT JOIN matters matter
         ON matter.id = i.matter_id
       WHERE i.archived_at IS NULL
         ${clientAccountId ? 'AND i.client_account_id = ?' : ''}
       ORDER BY i.issue_date DESC, i.created_at DESC`,
      clientAccountId ? [clientAccountId] : []
    );

    return rows.map((row) => ({
      amountDue: toNumber(row.amount_due),
      amountPaid: toNumber(row.amount_paid),
      amountRefunded: toNumber(row.amount_refunded),
      clientAccountId: row.client_account_public_id,
      currencyCode: row.currency_code,
      dueDate: row.due_date,
      id: row.public_id,
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      matterId: row.matter_public_id,
      statusCode: row.status_code,
      totalAmount: toNumber(row.total_amount),
      typeCode: row.invoice_type_code,
    })) satisfies InvoiceSummary[];
  }

  private async getInvoiceInternal(
    connection: PoolConnection,
    invoicePublicId: string,
    clientAccountId?: number
  ) {
    const row = await selectOne<InvoiceRow>(
      connection,
      `SELECT
         i.public_id,
         i.invoice_number,
         client.public_id AS client_account_public_id,
         matter.public_id AS matter_public_id,
         i.invoice_type_code,
         i.status_code,
         i.currency_code,
         i.issue_date,
         i.due_date,
         i.subtotal_amount,
         i.discount_amount,
         i.tax_amount,
         i.total_amount,
         i.amount_paid,
         i.amount_refunded,
         i.amount_due,
         i.template_public_id_snapshot,
         i.template_version_snapshot,
         i.rendered_subject_snapshot,
         i.rendered_body_snapshot,
         i.rendered_terms_snapshot,
         i.rendered_footer_snapshot,
         COALESCE(i.business_name_snapshot, settings.business_legal_name, settings.billing_display_name) AS business_name_snapshot,
         COALESCE(i.business_address_snapshot, settings.business_address) AS business_address_snapshot,
         COALESCE(i.business_phone_snapshot, settings.business_phone) AS business_phone_snapshot,
         COALESCE(i.business_email_snapshot, settings.business_email) AS business_email_snapshot,
         COALESCE(i.business_website_snapshot, settings.business_website) AS business_website_snapshot,
         COALESCE(i.business_gstin_snapshot, settings.gstin) AS business_gstin_snapshot,
         COALESCE(i.business_state_snapshot, settings.business_state) AS business_state_snapshot,
         COALESCE(i.payment_instructions_snapshot, settings.payment_instructions) AS payment_instructions_snapshot,
         i.created_at
       FROM invoices i
       INNER JOIN client_accounts client
         ON client.id = i.client_account_id
       LEFT JOIN matters matter
         ON matter.id = i.matter_id
       CROSS JOIN invoice_settings settings
       WHERE i.public_id = ?
         AND i.archived_at IS NULL
         ${clientAccountId ? 'AND i.client_account_id = ?' : ''}
       LIMIT 1`,
      clientAccountId ? [invoicePublicId, clientAccountId] : [invoicePublicId]
    );

    if (!row) {
      throw notFound('invoice_not_found', 'Invoice not found.');
    }

    const billingSnapshot = await selectOne<BillingSnapshotRow>(
      connection,
      `SELECT
         billing_name,
         billing_email,
         billing_phone,
         address_line1,
         address_line2,
         city,
         state,
         postal_code,
         country_code,
         gstin
       FROM invoice_billing_snapshots
       WHERE invoice_id = (
         SELECT id FROM invoices WHERE public_id = ? LIMIT 1
       )`,
      [invoicePublicId]
    );

    const lines = await selectAll<InvoiceLineRow>(
      connection,
      `SELECT
         il.id,
         il.line_type_code AS type_code,
         service.public_id AS service_public_id,
         il.subscription_plan_id,
         il.description,
         il.quantity,
         il.unit_price,
         il.line_subtotal,
         il.discount_amount,
         il.taxable_amount,
         il.line_total,
         il.sort_order
       FROM invoice_lines il
       INNER JOIN invoices i
         ON i.id = il.invoice_id
       LEFT JOIN services service
         ON service.id = il.service_id
       WHERE i.public_id = ?
       ORDER BY il.sort_order ASC, il.id ASC`,
      [invoicePublicId]
    );

    const taxes = await selectAll<InvoiceLineTaxRow>(
      connection,
      `SELECT
         ilt.id,
         ilt.invoice_line_id,
         ilt.tax_code_snapshot,
         ilt.tax_name_snapshot,
         ilt.tax_percent_snapshot,
         ilt.taxable_amount,
         ilt.tax_amount
       FROM invoice_line_taxes ilt
       INNER JOIN invoice_lines il
         ON il.id = ilt.invoice_line_id
       INNER JOIN invoices i
         ON i.id = il.invoice_id
       WHERE i.public_id = ?
       ORDER BY ilt.sort_order ASC, ilt.id ASC`,
      [invoicePublicId]
    );

    const taxMap = new Map<number, InvoiceLineTaxRow[]>();
    for (const tax of taxes) {
      const existing = taxMap.get(tax.invoice_line_id) || [];
      existing.push(tax);
      taxMap.set(tax.invoice_line_id, existing);
    }

    const installments = await selectAll<InvoiceInstallmentRow>(
      connection,
      `SELECT
         id,
         installment_no,
         due_date,
         amount_due,
         amount_paid,
         amount_remaining,
         status_code,
         paid_at
       FROM invoice_installments
       WHERE invoice_id = (
         SELECT id FROM invoices WHERE public_id = ? LIMIT 1
       )
       ORDER BY installment_no ASC`,
      [invoicePublicId]
    );

    const documents = await selectAll<LinkedEntityRow>(
      connection,
      `SELECT
         'invoice' AS type_code,
         d.public_id AS entity_public_id,
         d.title AS label
       FROM invoice_documents idoc
       INNER JOIN documents d
         ON d.id = idoc.document_id
       INNER JOIN invoices i
         ON i.id = idoc.invoice_id
       WHERE i.public_id = ?`,
      [invoicePublicId]
    );

    return {
      amountDue: toNumber(row.amount_due),
      amountPaid: toNumber(row.amount_paid),
      amountRefunded: toNumber(row.amount_refunded),
      business: {
        address: row.business_address_snapshot,
        email: row.business_email_snapshot,
        gstin: row.business_gstin_snapshot,
        name: row.business_name_snapshot,
        paymentInstructions: row.payment_instructions_snapshot,
        phone: row.business_phone_snapshot,
        state: row.business_state_snapshot,
        website: row.business_website_snapshot,
      },
      billingSnapshot: billingSnapshot
        ? {
            addressLine1: billingSnapshot.address_line1,
            addressLine2: billingSnapshot.address_line2,
            billingEmail: billingSnapshot.billing_email,
            billingName: billingSnapshot.billing_name,
            billingPhone: billingSnapshot.billing_phone,
            city: billingSnapshot.city,
            countryCode: billingSnapshot.country_code,
            gstin: billingSnapshot.gstin,
            postalCode: billingSnapshot.postal_code,
            state: billingSnapshot.state,
          }
        : null,
      clientAccountId: row.client_account_public_id,
      currencyCode: row.currency_code,
      discountAmount: toNumber(row.discount_amount),
      documents: documents.map((entry) => ({
        id: entry.entity_public_id,
        label: entry.label,
        type: entry.type_code,
      })),
      dueDate: row.due_date,
      id: row.public_id,
      installments: installments.map((entry) => ({
        amountDue: toNumber(entry.amount_due),
        amountPaid: toNumber(entry.amount_paid),
        amountRemaining: toNumber(entry.amount_remaining),
        dueDate: entry.due_date,
        id: entry.id,
        installmentNo: entry.installment_no,
        paidAt: entry.paid_at ? toIso(entry.paid_at) : null,
        statusCode: entry.status_code,
      })),
      invoiceNumber: row.invoice_number,
      issueDate: row.issue_date,
      lines: lines.map((entry) => ({
        description: entry.description,
        discountAmount: toNumber(entry.discount_amount),
        id: entry.id,
        lineSubtotal: toNumber(entry.line_subtotal),
        lineTotal: toNumber(entry.line_total),
        quantity: toNumber(entry.quantity),
        serviceId: entry.service_public_id,
        sortOrder: entry.sort_order,
        subscriptionPlanId: entry.subscription_plan_id,
        taxableAmount: toNumber(entry.taxable_amount),
        taxes: (taxMap.get(entry.id) || []).map((taxEntry) => ({
          amount: toNumber(taxEntry.tax_amount),
          code: taxEntry.tax_code_snapshot,
          id: taxEntry.id,
          name: taxEntry.tax_name_snapshot,
          percent: toNumber(taxEntry.tax_percent_snapshot),
        })),
        typeCode: entry.type_code,
        unitPrice: toNumber(entry.unit_price),
      })),
      matterId: row.matter_public_id,
      statusCode: row.status_code,
      paymentOptions: getInvoicePaymentOptions({
        amountDue: toNumber(row.amount_due),
        currencyCode: row.currency_code,
        installments: installments.map((entry) => ({
          amountRemaining: toNumber(entry.amount_remaining),
          statusCode: entry.status_code,
        })),
        statusCode: row.status_code,
      }),
      subtotalAmount: toNumber(row.subtotal_amount),
      taxAmount: toNumber(row.tax_amount),
      template: {
        body: row.rendered_body_snapshot,
        footer: row.rendered_footer_snapshot,
        id: row.template_public_id_snapshot,
        subject: row.rendered_subject_snapshot,
        terms: row.rendered_terms_snapshot,
        version: row.template_version_snapshot,
      },
      totalAmount: toNumber(row.total_amount),
      typeCode: row.invoice_type_code,
    } satisfies InvoiceDetail;
  }

  private async listPaymentsInternal(connection: PoolConnection, clientAccountId?: number) {
    const rows = await selectAll<PaymentRow>(
      connection,
      `SELECT
         pt.public_id,
         ca.public_id AS client_account_public_id,
         pt.gateway_provider_code,
         pt.gateway_order_ref,
         pt.gateway_payment_ref,
         pt.status_code,
         pt.currency_code,
         pt.gross_amount,
         pt.net_amount,
         pt.initiated_at,
         creator.public_id AS created_by_user_public_id,
         inv.public_id AS invoice_public_id
       FROM payment_transactions pt
       INNER JOIN client_accounts ca
         ON ca.id = pt.client_account_id
       LEFT JOIN users creator
         ON creator.id = pt.created_by_user_id
       LEFT JOIN payment_allocations pa
         ON pa.payment_transaction_id = pt.id
       LEFT JOIN invoices inv
         ON inv.id = pa.invoice_id
       WHERE 1 = 1
         ${clientAccountId ? 'AND pt.client_account_id = ?' : ''}
       GROUP BY pt.id, ca.public_id, creator.public_id, inv.public_id
       ORDER BY pt.initiated_at DESC`,
      clientAccountId ? [clientAccountId] : []
    );

    return rows.map((row) => ({
      clientAccountId: row.client_account_public_id,
      createdByUserId: row.created_by_user_public_id,
      currencyCode: row.currency_code,
      gatewayOrderRef: row.gateway_order_ref,
      gatewayPaymentRef: row.gateway_payment_ref,
      gatewayProviderCode: row.gateway_provider_code,
      grossAmount: toNumber(row.gross_amount),
      id: row.public_id,
      initiatedAt: toIso(row.initiated_at),
      invoiceId: row.invoice_public_id,
      netAmount: toNumber(row.net_amount),
      statusCode: row.status_code,
    })) satisfies PaymentSummary[];
  }

  private async listRefundsInternal(connection: PoolConnection, clientAccountId?: number) {
    const rows = await selectAll<RefundRow>(
      connection,
      `SELECT
         r.public_id,
         pt.public_id AS payment_public_id,
         inv.public_id AS invoice_public_id,
         r.amount,
         r.refund_status_code,
         r.reason_text,
         requested_by.public_id AS requested_by_user_public_id,
         approved_by.public_id AS approved_by_user_public_id,
         r.requested_at,
         r.completed_at
       FROM refunds r
       INNER JOIN payment_transactions pt
         ON pt.id = r.payment_transaction_id
       LEFT JOIN invoices inv
         ON inv.id = r.invoice_id
       INNER JOIN users requested_by
         ON requested_by.id = r.requested_by_user_id
       LEFT JOIN users approved_by
         ON approved_by.id = r.approved_by_user_id
       WHERE 1 = 1
         ${clientAccountId ? 'AND pt.client_account_id = ?' : ''}
       ORDER BY r.requested_at DESC`,
      clientAccountId ? [clientAccountId] : []
    );

    return rows.map((row) => ({
      amount: toNumber(row.amount),
      approvedByUserId: row.approved_by_user_public_id,
      completedAt: row.completed_at ? toIso(row.completed_at) : null,
      id: row.public_id,
      invoiceId: row.invoice_public_id,
      paymentId: row.payment_public_id,
      reasonText: row.reason_text,
      requestedAt: toIso(row.requested_at),
      requestedByUserId: row.requested_by_user_public_id,
      statusCode: row.refund_status_code,
    })) satisfies RefundSummary[];
  }
}
