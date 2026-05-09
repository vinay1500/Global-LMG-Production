import type {
  AuditEntry,
  ChatMessage,
  Invoice,
  Matter,
  Payment,
  PlatformDocument,
  PlatformEvent,
  PlatformUser,
  MessageThread,
  SystemNotification,
} from '../../data/adminTypes';

export interface ApiErrorResponse {
  error: string;
  issues?: unknown;
  message?: string;
  requestId?: string;
  retryAfterSeconds?: number;
}

export interface AdminSessionUser {
  displayName: string;
  email: string;
  id: string;
  mustRotatePassword: boolean;
  permissionCodes: string[];
  roleCodes: string[];
}

export interface AdminSessionResponse {
  authenticated: boolean;
  message?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
  user: AdminSessionUser | null;
}

export interface AdminMfaEnrollmentStartResponse {
  provisioningUri: string;
  qrCodeDataUrl: string;
  status: 'mfa_enrollment_started';
}

export interface AdminMfaEnrollmentVerifyResponse {
  recoveryCodes: string[];
  status: 'mfa_enabled';
}

export interface AdminMfaDisableResponse {
  status: 'mfa_disabled';
}

export interface AdminPasswordChangeResponse {
  status: 'password_changed';
  user: AdminSessionUser;
}

export interface AdminPasswordResetRequestResponse {
  deliveryMode: 'email' | 'manual';
  message: string;
  status: 'password_reset_requested';
}

export interface AdminPasswordResetConfirmResponse {
  message: string;
  status: 'password_reset_completed';
}

export interface AdminAccountProfile {
  avatarUrl: string | null;
  city: string;
  displayName: string;
  email: string;
  firstName: string;
  id: string;
  jobTitle: string;
  lastName: string;
  permissionCodes: string[];
  phone: string;
  roleCodes: string[];
  state: string;
  timezoneName: string;
}

export interface AdminAccountPreferences {
  avatarColor: string;
  dateFormat: string;
  defaultLandingPath:
    | '/billing'
    | '/clients'
    | '/dashboard'
    | '/documents'
    | '/matters'
    | '/meetings'
    | '/messages'
    | '/notifications'
    | '/reports'
    | '/requests';
  densityCode: 'comfortable' | 'compact';
  inAppNotificationsEnabled: boolean;
  timezoneName: string;
}

export interface AdminAccountResponse {
  preferences: AdminAccountPreferences;
  profile: AdminAccountProfile;
  security: {
    mfaEnabled: boolean;
    mfaEnabledAt: string | null;
    mfaRequirementMode: 'enforce' | 'off' | 'warn';
  };
}

export interface UpdateAdminProfilePayload {
  city?: string | null;
  displayName?: string;
  jobTitle?: string | null;
  phone?: string | null;
  state?: string | null;
}

export interface UpdateAdminPreferencesPayload {
  avatarColor?: string;
  dateFormat?: string;
  defaultLandingPath?: AdminAccountPreferences['defaultLandingPath'];
  densityCode?: AdminAccountPreferences['densityCode'];
  inAppNotificationsEnabled?: boolean;
  timezoneName?: string;
}

export interface ClientListItem extends PlatformUser {
  activeMatters: number;
  hasUnread: boolean;
  mattersCount: number;
  totalDue: number;
}

export interface PaginationMeta {
  hasMore: boolean;
  limit: number;
  offset: number;
  total: number;
}

export interface ClientsListResponse {
  clients: ClientListItem[];
  pagination?: PaginationMeta;
}

export interface CreateClientPayload {
  city?: string;
  clientType?: 'business' | 'individual' | 'organization';
  displayName: string;
  email: string;
  notes?: string;
  phone?: string;
  portalAccessEnabled?: boolean;
  primaryContactName: string;
  state?: string;
}

export interface CreateClientResponse {
  client: ClientListItem;
  portalInvite: {
    mode: 'manual';
    status: 'not_sent';
  };
  status: 'created';
}

export interface ClientWorkspaceResponse {
  auditEntries: AuditEntry[];
  client: PlatformUser;
  documents: PlatformDocument[];
  events: PlatformEvent[];
  invoices: Invoice[];
  matters: Matter[];
  notifications: SystemNotification[];
  payments: Payment[];
  requests: AdminRequestRecord[];
  summary: {
    activeMatterCount: number;
    documentCount: number;
    eventCount: number;
    invoiceCount: number;
    matterCount: number;
    notificationCount: number;
    outstandingBalance: number;
    paymentCount: number;
    requestCount: number;
    threadCount: number;
    totalBilled: number;
    totalPaid: number;
    unreadThreadCount: number;
  };
  threads: MessageThread[];
}

export interface MatterCreateOptions {
  clients: Array<{ email: string; id: string; name: string }>;
  consultationModes: Array<{ code: string; label: string }>;
  domains: Array<{ code: string; name: string }>;
  priorities: Array<{ code: string; label: string }>;
  services: Array<{ code: string; domainCode?: string; domainName?: string; name: string }>;
  stages: Array<{ code: string; label: string }>;
  statuses: Array<{ code: string; label: string }>;
  urgencyRules: Array<{ code: string; label: string }>;
}

export interface CreateMatterPayload {
  clientAccountPublicId: string;
  clientVisible?: boolean;
  consultationModeCode?: string;
  legalDomainCode?: string;
  priorityCode?: string;
  serviceCode?: string;
  serviceCodes?: string[];
  stageCode?: string;
  statusCode?: string;
  summary?: string;
  title: string;
  urgencyCode?: string;
}

export interface CreateMatterResponse {
  matter: Matter;
  status: 'created';
}

export interface MattersListResponse {
  createOptions?: MatterCreateOptions;
  matters: Matter[];
  pagination?: PaginationMeta;
}

export interface MatterWorkspaceResponse {
  assignmentOptions: {
    counsel: Array<{
      city?: string | null;
      country?: string | null;
      email?: string | null;
      id: string;
      name: string;
      phone?: string | null;
      specialization?: string | null;
      state?: string | null;
      type?: 'external_counsel' | 'field_partner';
    }>;
    staff: Array<{
      city?: string | null;
      country?: string | null;
      email?: string | null;
      id: string;
      name: string;
      phone?: string | null;
      specialization?: string | null;
      state?: string | null;
    }>;
  };
  createOptions?: MatterCreateOptions;
  documents: PlatformDocument[];
  events: PlatformEvent[];
  invoices: Invoice[];
  matter: Matter;
  threads: MessageThread[];
}

export interface MatterPackageProposalPackage {
  createdAt: string;
  createdBy: string;
  description: string;
  displayOrder: number;
  featurePoints: string[];
  id: string;
  isRecommended: boolean;
  isSelected: boolean;
  name: string;
  price: number;
  publishedAt?: string;
  selectedAt?: string;
  serviceCodes: string[];
  supersededAt?: string;
}

export interface MatterPackageProposalRecord {
  linkedInvoice: {
    id: string;
    invoiceNumber: string;
    matterPackageId: string;
    statusCode: string;
  } | null;
  packages: MatterPackageProposalPackage[];
  proposalVersion: number;
  publishedAt?: string;
  selectedAt?: string;
  selectedPackageId: string | null;
  status: 'archived' | 'draft' | 'published' | 'selected' | 'superseded';
  supersededAt?: string;
}

export interface MatterPackageProposalsResponse {
  active: MatterPackageProposalRecord | null;
  draft: MatterPackageProposalRecord | null;
  history: MatterPackageProposalRecord[];
  linkedInvoiceSummary: MatterPackageProposalRecord['linkedInvoice'] | null;
  matter: {
    id: string;
    matterNumber: string;
    title: string;
  };
  selectedPackageId: string | null;
}

export interface DocumentsListResponse {
  documentTypes?: SettingsDocumentType[];
  documents: PlatformDocument[];
  matters: Matter[];
  pagination?: PaginationMeta;
}

export interface AdminDocumentVersion {
  checksumSha256: string;
  fileExtension: string;
  fileSizeBytes: number;
  id: string;
  isCurrent: boolean;
  mimeType: string;
  originalFileName: string;
  retentionHold: boolean;
  reviewState: 'reviewed' | 'unreviewed';
  scanCheckedAt: string | null;
  scanError: string | null;
  scanProvider: string | null;
  uploadedAt: string;
  uploadedBy: string;
  versionNo: number;
  virusStatus: string;
}

export interface AdminDocumentDetailResponse {
  categoryCode: string;
  currentVersionNo: number;
  documentNumber: string;
  id: string;
  latestVersion: AdminDocumentVersion | null;
  ownerClientAccountId: string;
  title: string;
  versions: AdminDocumentVersion[];
  visibility: 'client' | 'internal';
  visibilityScopeCode: string;
}

export interface DocumentUploadResponse {
  documentId: string;
  status: 'uploaded' | 'version_uploaded';
  versionId?: string;
  versionNo?: number;
}

export interface AdminRequestRecord {
  clientEmail: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  consultationMode: string;
  createdAt: string;
  expertiseArea: string;
  id: string;
  issueSummary: string;
  matterId?: string;
  matterNumber?: string;
  ownerName: string;
  preferredEndAt?: string;
  preferredStartAt?: string;
  quoteTotalAmount: number;
  requestNumber: string;
  selectedServices: string[];
  statusCode: string;
  statusLabel: string;
  title: string;
  urgencyCode: string;
  urgencyLabel: string;
}

export interface RequestsWorkspaceResponse {
  metrics: {
    convertedThisMonth: number;
    openRequests: number;
    scheduledConsultations: number;
    urgentRequests: number;
  };
  requests: AdminRequestRecord[];
}

export interface AdminRequestDecisionResponse {
  matterId?: string;
  matterNumber?: string;
  message: string;
  requestId: string;
  requestNumber: string;
  status:
    | 'already_approved'
    | 'already_converted'
    | 'already_declined'
    | 'approved'
    | 'converted'
    | 'declined'
    | 'information_requested';
  statusCode: string;
  statusLabel: string;
}

export interface MessagesWorkspaceResponse {
  clients: PlatformUser[];
  events: PlatformEvent[];
  invoices: Invoice[];
  matters: Matter[];
  messages: ChatMessage[];
  pagination?: PaginationMeta;
  threads: MessageThread[];
}

export interface CreateMessageThreadResponse {
  messageId: string;
  status: 'created';
  threadId: string;
  threadNumber: string;
}

export interface AdminTaskRecord {
  assignee: string;
  client: string;
  dueDate: string;
  id: string;
  isOverdue: boolean;
  isToday: boolean;
  matter: string;
  note: string;
  priority: 'High' | 'Medium' | 'Low';
  sourceId: string;
  sourceType: 'document' | 'event' | 'invoice' | 'matter' | 'message' | 'reminder';
  status: 'completed' | 'in_progress' | 'todo' | 'waiting_client' | 'waiting_internal';
  title: string;
}

export interface TasksWorkspaceResponse {
  metrics: {
    completedRecent: number;
    dueToday: number;
    open: number;
    overdue: number;
    waiting: number;
  };
  tasks: AdminTaskRecord[];
}

export interface BillingWorkspaceResponse {
  invoices: Invoice[];
  invoiceSettings: InvoiceSettings;
  matters: Matter[];
  pagination?: PaginationMeta;
  payments: Payment[];
  refunds: RefundRecord[];
}

export interface RecordPaymentResponse {
  amountDue: number;
  amountPaid: number;
  invoiceId: string;
  invoiceStatus: string;
  paymentId: string;
  status: 'recorded';
}

export interface RefundRecord {
  amount: number;
  clientId: string;
  clientName: string;
  completedAt?: string;
  id: string;
  invoiceId: string;
  matterId: string;
  paymentId: string;
  reasonText: string;
  requestedAt: string;
  requestedBy: string;
  status: string;
}

export interface EventsWorkspaceResponse {
  clients: PlatformUser[];
  events: PlatformEvent[];
  matters: Matter[];
  pagination?: PaginationMeta;
}

export interface NotificationsListResponse {
  notifications: SystemNotification[];
  pagination?: PaginationMeta;
}

export interface ReminderQueueItem {
  channelCode: string;
  clientName?: string;
  deliveryModeLabel: string;
  eventId: string;
  eventTitle: string;
  failureReason?: string;
  id: string;
  lockedAt?: string;
  maxAttempts: number;
  nextAttemptAt?: string;
  recipientName: string;
  retryCount: number;
  scheduledAt: string;
  sentAt?: string;
  status: 'cancelled' | 'failed' | 'pending' | 'processing' | 'sent';
}

export interface ReminderWorkspaceResponse {
  metrics: {
    due: number;
    failed: number;
    pending: number;
    processing: number;
    sentRecent: number;
  };
  providerMode: {
    email: 'disabled' | 'preview' | 'resend';
    inApp: 'local';
    sms: 'disabled' | 'preview' | 'twilio-verify';
  };
  reminders: ReminderQueueItem[];
  status: 'ok';
}

export interface ReminderProcessResponse {
  alreadyNotified: number;
  failed: number;
  locked: number;
  processed: number;
  providerMode: ReminderWorkspaceResponse['providerMode'];
  skipped: number;
  status: 'processed';
}

export interface ReminderRetryResponse {
  providerMode: ReminderWorkspaceResponse['providerMode'];
  reminderId: string;
  status: 'already_sent' | 'retried' | 'skipped';
}

export interface AuditEntriesResponse {
  entries: AuditEntry[];
  pagination?: PaginationMeta;
}

export interface SearchResultItem {
  id: string;
  subtitle: string;
  title: string;
  type: 'Client' | 'Document' | 'Matter' | 'Message';
}

export interface SearchResultsResponse {
  results: SearchResultItem[];
}

export interface RbacWorkspaceResponse {
  permissions: Array<{
    actionName: string;
    code: string;
    description: string;
    moduleName: string;
  }>;
  roles: Array<{
    code: string;
    description: string;
    isActive: boolean;
    isSystem: boolean;
    name: string;
    permissionCodes: string[];
    userCount: number;
  }>;
  users: Array<{
    displayName: string;
    email: string;
    id: string;
    permissionCodes: string[];
    roleCodes: string[];
  }>;
}

export interface CreateRbacRolePayload {
  code?: string;
  description?: string;
  name: string;
}

export interface UpdateRbacRolePayload {
  description?: string;
  isActive?: boolean;
  name?: string;
}

export interface UpdateRbacRolePermissionsPayload {
  permissionCodes: string[];
}

export interface AssignRbacUserRolePayload {
  roleCode: string;
}

export interface DashboardWorkspaceResponse {
  accessOverview: {
    roles: RbacWorkspaceResponse['roles'];
    users: RbacWorkspaceResponse['users'];
  };
  aging: Array<{ amount: number; bucket: string }>;
  alertBanner: {
    staleMatters: number;
    summary: string;
  };
  metrics: {
    docBacklog: number;
    failedReminders?: number;
    openMatters: number;
    pendingInvoices: number;
    pendingReminders?: number;
    unreadThreads: number;
  };
  recentAudit: AuditEntry[];
  recentNotifications: SystemNotification[];
  revenueTrend: Array<{ month: string; revenue: number }>;
  stageMix: Array<{ name: string; value: number }>;
}

export interface ReportsWorkspaceResponse {
  documentActivity: Array<{ label: string; value: number }>;
  intakeTrend: Array<{ converted: number; leads: number; month: string }>;
  invoiceAging: Array<{ amount: number; bucket: string }>;
  kpis: {
    activeMatters: number;
    closedMatters: number;
    convertedRequests: number;
    declinedRequests: number;
    failedOperationalTasks: number;
    failedReminders: number;
    openRequests: number;
    outstandingInvoiceAmount: number;
    overdueInvoices: number;
    paidInvoiceAmount: number;
    pendingDocumentReviews: number;
    pendingReminders: number;
    recentClientActivity: number;
    staleMatters: number;
    upcomingEvents: number;
    waitingThreads: number;
  };
  resolutionTimes: Array<{ days: number; label: string }>;
  revenueTrend: Array<{ currentRevenue: number; month: string; previousRevenue: number }>;
  stageMix: Array<{ label: string; value: number }>;
  summary: {
    averageResolutionDays: number;
    clientConversionRate: number;
    refundsWriteOffs: number;
    totalCollections: number;
    totalRequests: number;
  };
  workloadByAssignee: Array<{
    activeMatters: number;
    label: string;
    utilizationRate: number;
    waitingThreads: number;
  }>;
}

export type ReportDrilldownKind =
  | 'active-matters'
  | 'closed-matters'
  | 'converted-requests'
  | 'declined-requests'
  | 'failed-reminders'
  | 'open-requests'
  | 'outstanding-invoices'
  | 'overdue-invoices'
  | 'paid-invoices'
  | 'pending-documents'
  | 'pending-reminders'
  | 'recent-notifications'
  | 'stale-matters'
  | 'upcoming-events'
  | 'waiting-threads';

export interface ReportDrilldownItem {
  amount?: number;
  clientName?: string;
  date?: string;
  id: string;
  matterTitle?: string;
  routeId?: string;
  routeType:
    | 'document'
    | 'event'
    | 'invoice'
    | 'matter'
    | 'message'
    | 'notification'
    | 'reminder'
    | 'request';
  status?: string;
  subtitle?: string;
  title: string;
}

export interface ReportDrilldownResponse {
  description: string;
  items: ReportDrilldownItem[];
  kind: ReportDrilldownKind;
  label: string;
  limit: number;
  offset: number;
  total: number;
}

export interface InvoiceSettings {
  billingDisplayName: string;
  businessAddress: string | null;
  businessEmail: string | null;
  businessLegalName: string;
  businessPhone: string | null;
  businessState: string;
  businessWebsite: string | null;
  defaultInvoiceTemplateId: string | null;
  defaultGstRateBps: number;
  defaultGstRatePercent: number;
  defaultSacCode: string | null;
  fallbackTaxType: 'cgst_sgst' | 'igst' | 'none';
  gstEnabled: boolean;
  gstin: string | null;
  invoiceFooter: string | null;
  invoicePrefix: string;
  invoiceTerms: string | null;
  paymentInstructions: string | null;
  paymentTermsDays: number;
  pricesIncludeTax: boolean;
  reverseChargeNote: string | null;
  taxMode: 'exempt' | 'forward_charge' | 'reverse_charge';
}

export type UpdateInvoiceSettingsPayload = Partial<{
  billingDisplayName: string;
  businessAddress: string | null;
  businessEmail: string | null;
  businessLegalName: string;
  businessPhone: string | null;
  businessState: string;
  businessWebsite: string | null;
  defaultInvoiceTemplateId: string | null;
  defaultGstRatePercent: number;
  defaultSacCode: string | null;
  fallbackTaxType: InvoiceSettings['fallbackTaxType'];
  gstEnabled: boolean;
  gstin: string | null;
  invoiceFooter: string | null;
  invoicePrefix: string;
  invoiceTerms: string | null;
  paymentInstructions: string | null;
  paymentTermsDays: number;
  pricesIncludeTax: boolean;
  reverseChargeNote: string | null;
  taxMode: InvoiceSettings['taxMode'];
}>;

export interface InvoicePdfTemplate {
  archivedAt: string | null;
  contentBottomMargin: number;
  contentLeftMargin: number;
  contentRightMargin: number;
  contentTopMargin: number;
  createdAt: string;
  fileSizeBytes: number;
  id: string;
  isActive: boolean;
  name: string;
  originalFileName: string;
  updatedAt: string;
}

export type InvoicePdfTemplateUploadPayload = {
  contentBase64: string;
  contentBottomMargin?: number;
  contentLeftMargin?: number;
  contentRightMargin?: number;
  contentTopMargin?: number;
  name: string;
  originalFileName: string;
  setActive?: boolean;
};

export type InvoicePdfTemplateUpdatePayload = Partial<{
  contentBottomMargin: number;
  contentLeftMargin: number;
  contentRightMargin: number;
  contentTopMargin: number;
  isActive: boolean;
  name: string;
}>;

export type PlatformSettingValue = boolean | number | string | null;

export interface PlatformSetting {
  category: string;
  description: string | null;
  isSensitive: boolean;
  key: string;
  label: string;
  masked: boolean;
  updatedAt: string;
  updatedBy: number | null;
  value: PlatformSettingValue;
  valueType: 'boolean' | 'decimal' | 'integer' | 'json' | 'select' | 'string' | 'text';
  version: number;
}

export interface PlatformSettingsResponse {
  settings: PlatformSetting[];
}

export interface UpdatePlatformSettingPayload {
  value: PlatformSettingValue;
  version?: number;
}

export interface SettingsServiceDomain {
  code: string;
  isActive: boolean;
  name: string;
  sortOrder: number;
}

export interface SettingsService {
  baseFee: number;
  code: string;
  description: string;
  domainCode?: string;
  domainName?: string;
  icon: string;
  id: string;
  isActive: boolean;
  name: string;
  sortOrder: number;
}

export interface SettingsPricingSlab {
  baseAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  id: string;
  isActive: boolean;
  maxServiceCount: number | null;
  minServiceCount: number;
  perExtraServiceAmount: number | null;
}

export interface SettingsUrgencyRule {
  allowInPerson: boolean;
  allowPhone: boolean;
  allowVideo: boolean;
  allowedConsultationModes?: string[];
  code: string;
  id: string;
  isActive: boolean;
  label: string;
  maxResponseHours: number | null;
  minResponseHours: number | null;
  responseWindowHours: number | null;
  sortOrder: number;
  surchargeType: 'flat' | 'percent' | string;
  surchargeValue: number;
  timingLabel: string;
}

export interface SettingsConsultationMode {
  code: string;
  description: string;
  isActive: boolean;
  label: string;
  sortOrder: number;
  surchargeValue: number;
  transportDisclaimer: string;
}

export interface SettingsCountryPricing {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  id: string;
  isActive: boolean;
  isDefault: boolean;
  multiplier: number;
}

export type PricingSubjectType = 'consultation_mode' | 'service' | 'urgency';

export interface SettingsPriceOverride {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  id: string;
  isActive: boolean;
  priceAmount: number;
  subjectCode: string;
  subjectType: PricingSubjectType;
}

export interface SettingsExchangeRate {
  baseCurrency: string;
  fetchedAt: string;
  id: string;
  provider: string;
  quoteCurrency: string;
  rate: number;
  rateDate: string;
}

export interface ServiceCatalogResponse {
  domains: SettingsServiceDomain[];
  services: SettingsService[];
}

export interface PricingRulesResponse {
  consultationModes: SettingsConsultationMode[];
  countryPricing: SettingsCountryPricing[];
  exchangeRates: SettingsExchangeRate[];
  priceOverrides: SettingsPriceOverride[];
  urgencyRules: SettingsUrgencyRule[];
}

export interface CreateServiceCatalogPayload {
  baseFee?: number;
  code?: string;
  description?: string | null;
  domainCode?: string | null;
  icon?: string | null;
  isActive?: boolean;
  name: string;
  sortOrder?: number;
}

export type UpdateServiceCatalogPayload = Partial<Omit<CreateServiceCatalogPayload, 'code'>>;

export interface PricingSlabPayload {
  baseAmount: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive?: boolean;
  maxServiceCount?: number | null;
  minServiceCount: number;
  perExtraServiceAmount?: number | null;
}

export interface UrgencyRulePayload {
  allowInPerson?: boolean;
  allowPhone?: boolean;
  allowVideo?: boolean;
  code?: string;
  isActive?: boolean;
  label: string;
  maxResponseHours?: number | null;
  minResponseHours?: number | null;
  responseWindowHours?: number | null;
  sortOrder?: number;
  surchargeType: 'flat' | 'percent';
  surchargeValue: number;
  timingLabel?: string | null;
}

export type UpdateUrgencyRulePayload = Partial<Omit<UrgencyRulePayload, 'code'>>;

export interface ConsultationModePayload {
  code?: string;
  description?: string | null;
  isActive?: boolean;
  label: string;
  sortOrder?: number;
  surchargeValue?: number;
  transportDisclaimer?: string | null;
}

export type UpdateConsultationModePayload = Partial<Omit<ConsultationModePayload, 'code'>>;

export interface CountryPricingPayload {
  countryCode?: string;
  countryName: string;
  currencyCode: string;
  isActive?: boolean;
  isDefault?: boolean;
  multiplier: number;
}

export type UpdateCountryPricingPayload = Partial<Omit<CountryPricingPayload, 'countryCode'>>;

export interface PriceOverridePayload {
  countryCode: string;
  countryName?: string;
  currencyCode: string;
  isActive?: boolean;
  priceAmount: number;
  subjectCode: string;
  subjectType: PricingSubjectType;
}

export type UpdatePriceOverridePayload = Partial<Omit<PriceOverridePayload, 'subjectCode' | 'subjectType'>>;

export type TemplateType = 'document_checklist' | 'general' | 'invoice' | 'message' | 'notification';

export interface AdminTemplate {
  archivedAt: string | null;
  body: string;
  createdAt: string;
  id: string;
  isActive: boolean;
  isDefault: boolean;
  name: string;
  subject: string | null;
  type: TemplateType;
  updatedAt: string;
  variables: string[];
  version: number;
}

export interface TemplatesResponse {
  templates: AdminTemplate[];
}

export interface TemplatePayload {
  body: string;
  isActive?: boolean;
  name: string;
  subject?: string | null;
  type: TemplateType;
  variables?: string[];
}

export type UpdateTemplatePayload = Partial<Omit<TemplatePayload, 'type'>>;

export interface SettingsDocumentType {
  allowedExtensions: string[];
  archivedAt?: string | null;
  category: string;
  clientVisibleDefault: boolean;
  code: string;
  description: string;
  displayOrder: number;
  id: string;
  isActive: boolean;
  maxSizeMb: number;
  name: string;
  requiresReview: boolean;
  updatedAt?: string;
  usageCount?: number;
}

export interface DocumentTypesResponse {
  documentTypes: SettingsDocumentType[];
}

export interface DocumentTypePayload {
  allowedExtensions: string[];
  category: string;
  clientVisibleDefault?: boolean;
  code?: string;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  maxSizeMb: number;
  name: string;
  requiresReview?: boolean;
}

export type UpdateDocumentTypePayload = Partial<Omit<DocumentTypePayload, 'code'>>;

export type NotificationChannelCode = 'email' | 'in_app' | 'sms';

export interface NotificationDeliverySetting {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  isActive: boolean;
  label: string;
  pushEnabled: boolean;
  smsEnabled: boolean;
  sortOrder: number;
  template: { id: string; name: string; type: string } | null;
  templateId: string | null;
  typeCode: string;
}

export interface ReminderSetting {
  archivedAt: string | null;
  channelCode: NotificationChannelCode;
  displayOrder: number;
  eventTypeCode: string | null;
  eventTypeLabel: string;
  id: string;
  isActive: boolean;
  offsetMinutes: number;
}

export interface NotificationSettingsResponse {
  deliverySettings: NotificationDeliverySetting[];
  eventTypes: Array<{ code: string; label: string }>;
  providerMode: {
    email: 'disabled' | 'preview' | 'resend';
    inApp: 'local';
    push: 'disabled';
    sms: 'disabled' | 'preview' | 'twilio-verify';
  };
  reminderSettings: ReminderSetting[];
  templates: Array<{ id: string; name: string }>;
}

export interface NotificationDeliverySettingPayload {
  emailEnabled?: boolean;
  inAppEnabled?: boolean;
  isActive?: boolean;
  pushEnabled?: boolean;
  smsEnabled?: boolean;
  templateId?: string | null;
}

export interface ReminderSettingPayload {
  channelCode: NotificationChannelCode;
  eventTypeCode?: string | null;
  isActive?: boolean;
  offsetMinutes: number;
}

export type UpdateReminderSettingPayload = Partial<ReminderSettingPayload>;

export type TeamMemberType = 'external_counsel' | 'field_partner' | 'internal_staff';

export interface TeamRegistryMember {
  active: boolean;
  assignmentCount: number;
  city: string;
  country: string;
  email: string;
  id: string;
  name: string;
  phone: string;
  specialization: string;
  state: string;
  type: TeamMemberType;
}

export interface TeamRegistryResponse {
  canManage: boolean;
  members: TeamRegistryMember[];
}

export interface TeamMemberPayload {
  active?: boolean;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  name: string;
  phone?: string | null;
  specialization?: string | null;
  state?: string | null;
  type: TeamMemberType;
}

export type UpdateTeamMemberPayload = Partial<Omit<TeamMemberPayload, 'type'>>;

export interface SettingsWorkspaceResponse {
  consultationModes: Array<{
    code: string;
    isActive: boolean;
    label: string;
  }>;
  documentCategories: Array<{
    code: string;
    usageCount: number;
  }>;
  documentTypes: SettingsDocumentType[];
  invoiceConfiguration: {
    defaultManualDueDays: number;
    invoiceStatuses: Array<{ code: string; label: string }>;
    latestInvoiceNumber: string | null;
    nextInvoiceNumber: string | null;
    pdfTemplates: InvoicePdfTemplate[];
    settings: InvoiceSettings;
    taxRates: Array<{
      code: string;
      isActive: boolean;
      name: string;
      ratePercent: number;
    }>;
  };
  notificationTypes: Array<{
    code: string;
    label: string;
  }>;
  notificationSettings: NotificationSettingsResponse;
  platformSettings: PlatformSetting[];
  pricingRules: {
    consultationModes: SettingsConsultationMode[];
    countryPricing: SettingsCountryPricing[];
    exchangeRates: SettingsExchangeRate[];
    priceOverrides: SettingsPriceOverride[];
    urgencyRules: SettingsUrgencyRule[];
  };
  rbac: {
    canManage: boolean;
    permissions: RbacWorkspaceResponse['permissions'];
    roles: RbacWorkspaceResponse['roles'];
    users: RbacWorkspaceResponse['users'];
  };
  serviceDomains: SettingsServiceDomain[];
  services: SettingsService[];
  teamRegistry: TeamRegistryResponse;
  templates: AdminTemplate[];
}
