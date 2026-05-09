export interface AmountSummary {
  due: number;
  paid: number;
  quoted: number;
  refunded?: number;
}

export interface ClientAccountSummary {
  accountStatusCode: string;
  clientCode: string;
  clientTypeCode: string;
  displayName: string;
  id: string;
  legalName: string;
  onboardingStatusCode: string;
  ownerUserId: string | null;
  primaryEmail: string;
  primaryPhone: string;
}

export interface ClientAccountContact {
  contactRoleCode: string;
  email: string;
  id: string;
  isBilling: boolean;
  isPrimary: boolean;
  name: string;
  phone: string | null;
  portalAccessEnabled: boolean;
}

export interface ClientAddress {
  addressTypeCode: string;
  city: string;
  countryCode: string;
  id: number;
  isPrimary: boolean;
  line1: string;
  line2: string | null;
  postalCode: string;
  state: string;
}

export interface ClientAccountDetail extends ClientAccountSummary {
  addresses: ClientAddress[];
  contacts: ClientAccountContact[];
  matterCount: number;
}

export interface MatterServiceItem {
  completedAt: string | null;
  fee: number;
  name: string;
  serviceCode: string;
  statusCode: string;
}

export interface MatterAssignmentItem {
  assignedAt: string;
  assignedByUserId: string;
  assigneeId: string;
  assigneeName: string;
  assigneeType: 'internal_user' | 'counsel_partner';
  assignmentRoleCode: string;
  assignmentStatusCode: string;
  feeAgreedAmount: number | null;
  feeDueAmount: number | null;
  feePaidAmount: number | null;
  id: number;
  isPrimary: boolean;
  removedAt: string | null;
}

export interface MatterStageHistoryItem {
  changedByUserId: string | null;
  changeNote: string | null;
  enteredAt: string;
  exitedAt: string | null;
  label: string;
  stageCode: string;
  visibleToClient: boolean;
}

export interface MatterUpdateItem {
  bodyText: string;
  createdAt: string;
  createdByUserId: string | null;
  editedAt: string | null;
  id: number;
  title: string;
  typeCode: string;
  visibleToClient: boolean;
}

export interface MatterDocumentLink {
  categoryCode: string;
  documentNumber: string;
  id: string;
  latestFileName: string;
  title: string;
  visibilityScopeCode: string;
}

export interface MatterSummary {
  clientAccountId: string;
  clientName: string;
  consultationModeCode: string;
  currentStageCode: string;
  currentStageLabel: string;
  id: string;
  issueSummary: string;
  lastActivityAt: string;
  legalDomainName: string;
  matterNumber: string;
  openedAt: string;
  operationalStatusCode: string;
  priorityCode: string;
  title: string;
  totals: AmountSummary;
  urgencyCode: string;
}

export interface MatterDetail extends MatterSummary {
  assignments: MatterAssignmentItem[];
  description: string | null;
  documents: MatterDocumentLink[];
  services: MatterServiceItem[];
  stageHistory: MatterStageHistoryItem[];
  updates: MatterUpdateItem[];
}

export interface DocumentVersionSummary {
  checksumSha256: string;
  fileExtension: string;
  fileSizeBytes: number;
  id: string;
  isCurrent: boolean;
  mimeType: string;
  originalFileName: string;
  retentionHoldFlag: boolean;
  uploadedAt: string;
  uploadedByUserId: string;
  versionNo: number;
  virusScanStatusCode: string;
}

export interface LinkedEntityReference {
  id: string;
  label: string;
  type: 'invoice' | 'matter' | 'request';
}

export interface DocumentSummary {
  categoryCode: string;
  currentVersionNo: number;
  id: string;
  latestVersion: DocumentVersionSummary | null;
  ownerClientAccountId: string;
  title: string;
  visibilityScopeCode: string;
}

export interface DocumentDetail extends DocumentSummary {
  documentNumber: string;
  downloads: Array<{
    downloadedAt: string;
    downloadedByUserId: string;
    id: number;
    versionId: string;
  }>;
  linkedEntities: LinkedEntityReference[];
  versions: DocumentVersionSummary[];
}

export interface EventParticipantSummary {
  attendanceStatusCode: string;
  id: number;
  joinedAt: string | null;
  leftAt: string | null;
  name: string;
  participantId: string;
  participantRoleCode: string;
  participantType: 'client_contact' | 'counsel_partner' | 'internal_user';
  rsvpStatusCode: string;
}

export interface EventSummary {
  clientAccountId: string;
  clientVisibleFlag: boolean;
  id: string;
  locationText: string | null;
  matterId: string | null;
  matterTitle: string | null;
  meetingProviderCode: string;
  modeCode: string;
  scheduledEndAt: string;
  scheduledStartAt: string;
  statusCode: string;
  timezoneName: string;
  title: string;
  typeCode: string;
}

export interface EventDetail extends EventSummary {
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  hostUrl: string | null;
  joinUrl: string | null;
  notes: string | null;
  participants: EventParticipantSummary[];
}

export interface InvoiceLineTaxSummary {
  amount: number;
  code: string;
  id: number;
  name: string;
  percent: number;
}

export interface InvoiceLineSummary {
  description: string;
  discountAmount: number;
  id: number;
  lineSubtotal: number;
  lineTotal: number;
  quantity: number;
  serviceId: string | null;
  sortOrder: number;
  subscriptionPlanId: number | null;
  taxableAmount: number;
  taxes: InvoiceLineTaxSummary[];
  typeCode: string;
  unitPrice: number;
}

export interface InvoiceInstallmentSummary {
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  dueDate: string;
  id: number;
  installmentNo: number;
  paidAt: string | null;
  statusCode: string;
}

export interface InvoicePaymentOptions {
  allowsPartial: boolean;
  amountDue: number;
  currencyCode: string;
  minimumPaymentAmount: number;
  offlineEnabled: boolean;
  onlineEnabled: boolean;
  payable: boolean;
  paymentDisabledReason: string | null;
  paymentProvider: 'razorpay' | null;
  suggestedPaymentAmount: number;
}

export interface InvoiceSummary {
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  clientAccountId: string;
  currencyCode: string;
  dueDate: string;
  id: string;
  invoiceNumber: string;
  issueDate: string;
  matterId: string | null;
  statusCode: string;
  totalAmount: number;
  typeCode: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  business: {
    address: string | null;
    email: string | null;
    gstin: string | null;
    name: string | null;
    paymentInstructions: string | null;
    phone: string | null;
    state: string | null;
    website: string | null;
  };
  billingSnapshot: {
    addressLine1: string;
    addressLine2: string | null;
    billingEmail: string;
    billingName: string;
    billingPhone: string;
    city: string;
    countryCode: string;
    gstin: string | null;
    postalCode: string;
    state: string;
  } | null;
  discountAmount: number;
  documents: LinkedEntityReference[];
  installments: InvoiceInstallmentSummary[];
  lines: InvoiceLineSummary[];
  paymentOptions: InvoicePaymentOptions;
  subtotalAmount: number;
  taxAmount: number;
  template: {
    body: string | null;
    footer: string | null;
    id: string | null;
    subject: string | null;
    terms: string | null;
    version: number | null;
  };
}

export interface PaymentSummary {
  clientAccountId: string;
  createdByUserId: string | null;
  currencyCode: string;
  gatewayOrderRef: string | null;
  gatewayPaymentRef: string | null;
  gatewayProviderCode: string;
  grossAmount: number;
  id: string;
  initiatedAt: string;
  invoiceId: string | null;
  netAmount: number;
  statusCode: string;
}

export interface RefundSummary {
  amount: number;
  approvedByUserId: string | null;
  completedAt: string | null;
  id: string;
  invoiceId: string | null;
  paymentId: string;
  reasonText: string;
  requestedAt: string;
  requestedByUserId: string;
  statusCode: string;
}

export interface CounselPartnerSummary {
  availabilityStatusCode: string;
  counselCode: string;
  email: string;
  fullName: string;
  id: string;
  locationLabel: string;
  organizationName: string | null;
  partnerStatusCode: string;
  phone: string;
  yearsExperience: number;
}

export interface CounselPartnerDetail extends CounselPartnerSummary {
  barRegistrationNumber: string | null;
  expertise: Array<{
    domainCode: string;
    domainName: string;
    proficiencyLevelCode: string;
    serviceCode: string | null;
    serviceName: string | null;
    yearsExperience: number;
  }>;
  invitedUserId: string | null;
  primaryJurisdiction: string;
}

export interface RoleSummary {
  code: string;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  name: string;
}

export interface PermissionSummary {
  actionName: string;
  code: string;
  description: string | null;
  moduleName: string;
}

export interface UserRoleSummary {
  accountStatusCode: string;
  actorTypeCode: string;
  displayName: string;
  email: string;
  id: string;
  roleCodes: string[];
}

export interface UpdateMatterStageInput {
  changeNote?: string;
  operationalStatusCode?: string;
  stageCode: string;
  visibleToClient?: boolean;
}

export interface CreateMatterAssignmentInput {
  assignmentRoleCode: string;
  counselPartnerId?: string;
  feeAgreedAmount?: number;
  feeDueAmount?: number;
  feePaidAmount?: number;
  internalUserId?: string;
  isPrimary?: boolean;
  notes?: string;
}

export interface CreateEventParticipantInput {
  clientContactUserId?: string;
  counselPartnerId?: string;
  internalUserId?: string;
  participantRoleCode: string;
  rsvpStatusCode?: string;
}

export interface CreateEventInput {
  clientAccountId: string;
  clientVisibleFlag?: boolean;
  joinUrl?: string;
  locationText?: string;
  matterId?: string;
  meetingProviderCode?: string;
  modeCode: string;
  notes?: string;
  participants?: CreateEventParticipantInput[];
  scheduledEndAt: string;
  scheduledStartAt: string;
  statusCode?: string;
  timezoneName?: string;
  title: string;
  typeCode: string;
}

export interface CreateRefundInput {
  amount: number;
  invoiceId?: string;
  paymentId: string;
  reasonText: string;
}

export interface ReplaceUserRolesInput {
  roleCodes: string[];
}
