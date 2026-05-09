import type {
  Advocate,
  AuditEntry,
  ChatMessage,
  ConsultationMode,
  Invoice,
  Lead,
  Matter,
  MatterPackage,
  MessageThread,
  Payment,
  PlatformDocument,
  PlatformEvent,
  PlatformUser,
  StaffMember,
} from '../../data/dashboardTypes';
import type { UrgencyLevel } from '../../data/requestWizardData';

export interface ApiErrorResponse {
  error: string;
  message?: string;
  issues?: unknown;
  requestId?: string;
  retryAfterSeconds?: number;
}

export interface ApiHealthResponse {
  environment?: string;
  service: string;
  status: 'ok';
  timestamp: string;
  uptimeSeconds?: number;
}

export interface AuthSessionUser {
  avatar: string;
  email: string;
  id: string;
  joinedAt: string;
  lastActiveAt: string;
  lifecycle: string;
  name: string;
  owner: string;
  phone: string;
  region: string;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthSessionUser | null;
}

export interface AuthActionResponse {
  status:
    | 'authenticated'
    | 'email_verification_required'
    | 'phone_capture_required'
    | 'phone_otp_required'
    | 'password_reset_requested'
    | 'password_reset_completed';
  message: string;
  deliveryHint?: string;
  email?: string;
  phone?: string;
  user?: AuthSessionUser;
}

export interface DashboardRequestDocumentPayload {
  name: string;
  size: number;
  type: string;
}

export interface DashboardRequestSubmissionPayload {
  caseDetails: string;
  consultationMode: ConsultationMode;
  documentUploadIds: string[];
  documents: DashboardRequestDocumentPayload[];
  legalDomain: string;
  pastLegalAction: boolean;
  preferredDate: string;
  preferredEndAtUtc?: string;
  preferredStartAtUtc?: string;
  preferredTime: string;
  preferredTimezone?: string;
  services: string[];
  urgency: UrgencyLevel;
}

export interface RequestPricingConfigResponse {
  consultationModes: Array<{
    description: string;
    fee: number;
    id: string;
    isInPerson: boolean;
    label: string;
    transportDisclaimer: string | null;
  }>;
  countryPricing: {
    countryCode: string;
    countryName: string;
    countrySource: 'default' | 'ip_geolocation' | 'phone' | 'request' | 'saved_address';
    currencyCode: string;
    isDefaultFallback: boolean;
    multiplier: number;
    pricingCountryConfidence: 'fallback' | 'high' | 'medium';
  };
  currencyCode: string;
  detectedCountryCode: string;
  detectedCurrency: string;
  legalDomains: Array<{
    description: string;
    id: string;
    name: string;
  }>;
  showApproximateLocalCurrency: boolean;
  services: Array<{
    baseFee: number;
    description: string;
    icon: string;
    id: string;
    name: string;
  }>;
  urgencyOptions: Array<{
    allowedConsultationModes: string[];
    id: string;
    isImmediate: boolean;
    label: string;
    maxResponseHours: number | null;
    minResponseHours: number | null;
    responseWindowHours: number | null;
    surcharge: number;
    surchargeType: 'flat' | 'percent';
    timingLabel: string;
  }>;
}

export interface DashboardMessageSubmissionPayload {
  attachmentUploadIds?: string[];
  content: string;
  threadId: string;
}

export interface CreateUploadIntentPayload {
  checksumSha256: string;
  mimeType: string;
  originalName: string;
  relatedEntityId?: string;
  relatedEntityType?: 'invoice' | 'matter' | 'request' | 'thread';
  sizeBytes: number;
  sourceModule: string;
}

export interface StoredUploadResponse {
  checksumSha256: string;
  createdAt: string;
  finalizedAt?: string;
  id: string;
  mimeType: string;
  originalName: string;
  ownerAccountId: string;
  relatedEntityId?: string;
  relatedEntityType?: 'invoice' | 'matter' | 'request' | 'thread';
  sizeBytes: number;
  sourceModule: string;
  status: 'pending' | 'stored' | 'attached' | 'failed';
  storageDriver: 'local';
  storageKey: string;
}

export interface CreateUploadIntentResponse {
  maxSizeBytes: number;
  upload: StoredUploadResponse;
  uploadId: string;
  uploadUrl: string;
}

export interface StoreUploadContentResponse {
  status: 'stored';
  upload: StoredUploadResponse;
}

export interface DashboardSnapshotResponse {
  advocates: Advocate[];
  auditEntries: AuditEntry[];
  currentClient: PlatformUser;
  documents: PlatformDocument[];
  events: PlatformEvent[];
  invoices: Invoice[];
  leads: Lead[];
  matters: Matter[];
  messages: ChatMessage[];
  packages: MatterPackage[];
  payments: Payment[];
  staff: StaffMember[];
  threads: MessageThread[];
  users: PlatformUser[];
}

export interface DashboardPackageSelectionResponse {
  generatedInvoiceId: string;
  selectedPackageId: string;
  snapshot: DashboardSnapshotResponse;
}

export interface NotificationPreferencesResponse {
  caseActivityAlerts: boolean;
  emailUpdates: boolean;
  inAppAlerts: boolean;
  invoiceReminders: boolean;
  productAnnouncements: boolean;
  smsAlerts: boolean;
}

export type UpdateNotificationPreferencesPayload = NotificationPreferencesResponse;

export interface ClientAccountSettingsResponse {
  account: {
    address: {
      city: string;
      countryCode: string;
      line1: string;
      line2: string;
      postalCode: string;
      sourceCode: 'google' | 'ip_prefill' | 'manual';
      state: string;
      validationStatusCode: 'manual' | 'unverified' | 'verified';
    };
    email: string;
    emailVerified: boolean;
    mobileNumber: string;
    name: string;
    phone: string;
    phoneVerified: boolean;
  };
  deliveryAvailability: {
    email: 'available' | 'unavailable';
    portal: 'available';
    sms: 'available' | 'unavailable';
  };
}

export interface AccountChangeRequestResponse {
  deliveryHint?: string;
  deliveryStatus?: 'queued' | 'sent' | 'verification_required';
  email?: string;
  phone?: string;
  status: 'verification_required';
}

export interface PortalNotificationResponse {
  actionLabel: string;
  actionTarget: 'billing' | 'cases' | 'documents' | 'messages';
  createdAt: string;
  description: string;
  id: string;
  isRead: boolean;
  meta: string;
  priorityCode: string;
  threadId: string | null;
  title: string;
  typeCode: string;
  typeLabel: string;
}

export interface InvoiceLineTaxSummaryResponse {
  amount: number;
  code: string;
  id: number;
  name: string;
  percent: number;
}

export interface InvoiceLineSummaryResponse {
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
  taxes: InvoiceLineTaxSummaryResponse[];
  typeCode: string;
  unitPrice: number;
}

export interface InvoiceInstallmentSummaryResponse {
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  dueDate: string;
  id: number;
  installmentNo: number;
  paidAt: string | null;
  statusCode: string;
}

export interface LinkedInvoiceEntityResponse {
  id: string;
  label: string;
  type: 'invoice' | 'matter' | 'request';
}

export interface InvoiceDetailResponse {
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
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
  clientAccountId: string;
  currencyCode: string;
  discountAmount: number;
  documents: LinkedInvoiceEntityResponse[];
  dueDate: string;
  id: string;
  installments: InvoiceInstallmentSummaryResponse[];
  invoiceNumber: string;
  issueDate: string;
  lines: InvoiceLineSummaryResponse[];
  matterId: string | null;
  paymentOptions: {
    allowsPartial: boolean;
    amountDue: number;
    currencyCode: string;
    minimumPaymentAmount: number;
    offlineEnabled: boolean;
    onlineEnabled: boolean;
    suggestedPaymentAmount: number;
  };
  statusCode: string;
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
  totalAmount: number;
  typeCode: string;
}

export interface InvoicePaymentOrderResponse {
  amount: number;
  amountMinor: number;
  currencyCode: string;
  customer: {
    email: string;
    name: string;
    phone: string | null;
  };
  invoiceId: string;
  invoiceNumber: string;
  keyId: string;
  orderId: string;
  provider: 'razorpay';
  receipt: string;
}

export interface InvoicePaymentVerifyResponse {
  amountDue: number;
  amountPaid: number;
  invoiceId: string;
  invoiceStatus: string;
  paymentId: string | null;
  status: 'authorized' | 'paid';
}

export interface RequestPaymentOrderResponse {
  amount: number;
  amountMinor: number;
  currencyCode: string;
  customer: {
    email: string;
    name: string;
    phone: string | null;
  };
  keyId: string;
  orderId: string;
  provider: 'razorpay';
  receipt: string;
  requestId: string;
  requestNumber: string;
}

export interface DashboardRequestPaymentSubmissionResponse {
  paymentOrder: RequestPaymentOrderResponse;
  requestId: string;
}

export interface DashboardRequestPaymentVerifyResponse {
  matterId: string | null;
  paymentId: string | null;
  requestId: string;
  status: 'authorized' | 'submitted';
}
