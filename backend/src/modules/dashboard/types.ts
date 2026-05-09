export type UserLifecycle =
  | 'lead'
  | 'registered'
  | 'consultation-scheduled'
  | 'consultation-completed'
  | 'fee-pending'
  | 'client';

export type ConsultationMode = string;
export type LifecycleStage =
  | 'request-received'
  | 'verification-call'
  | 'consultation'
  | 'action-plan'
  | 'resolution';
export type OperationalStatus =
  | 'new-lead'
  | 'awaiting-verification'
  | 'verification-done'
  | 'verification-scheduled'
  | 'consultation-scheduled'
  | 'consultation-completed'
  | 'fee-pending'
  | 'package-ready'
  | 'invoice-sent'
  | 'awaiting-payment'
  | 'paid'
  | 'work-in-progress'
  | 'awaiting-client'
  | 'awaiting-team'
  | 'immediate'
  | 'completed'
  | 'archived'
  | 'lost-closed';
export type PriorityBadge = 'awaiting-client' | 'in-progress' | 'immediate-6h' | 'completed';
export type InvoiceStatus = 'draft' | 'sent' | 'pending' | 'paid' | 'overdue' | 'refunded' | 'void';
export type EventType = 'consultation' | 'hearing' | 'verification-call';
export type DocReviewState = 'unreviewed' | 'reviewed' | 'needs-client-action';
export type AdminRole = 'case-manager' | 'billing-admin' | 'ops-admin';
export type UrgencyLevel = string;
export type MatterPackageProposalStatus =
  | 'draft'
  | 'published'
  | 'selected'
  | 'superseded'
  | 'archived';

export interface StageItem {
  completed: boolean;
  id: LifecycleStage;
  label: string;
}

export interface PlatformUser {
  avatar: string;
  countryCode?: string;
  email: string;
  id: string;
  joinedAt: string;
  lastActiveAt: string;
  lifecycle: UserLifecycle;
  name: string;
  owner?: string;
  phone: string;
  region?: string;
}

export interface Lead {
  assignedOwner: string;
  consultationMode: ConsultationMode;
  consultationStatus: 'not-scheduled' | 'scheduled' | 'completed' | 'cancelled';
  createdAt: string;
  expertiseArea: string;
  id: string;
  issueSummary: string;
  notes: string;
  paymentStatus: 'none' | 'invoice-sent' | 'paid' | 'overdue';
  preferredSlot: string;
  selectedServices: string[];
  status:
    | 'new-lead'
    | 'submitted'
    | 'awaiting-verification'
    | 'consultation-scheduled'
    | 'consultation-completed'
    | 'fee-pending'
    | 'converted'
    | 'lost-closed';
  urgency: UrgencyLevel;
  userId: string;
}

export interface Matter {
  assignments?: Array<{
    id: string;
    name: string;
    type: 'external_counsel' | 'field_partner' | 'internal_staff';
    visibleToClient: boolean;
  }>;
  assignedCounsel?: string;
  assignedStaff?: string;
  clientId: string;
  clientName: string;
  clientVisibleNotes: string[];
  consultationMode: ConsultationMode;
  createdAt: string;
  currencyCode?: string;
  dueAmount: number;
  expertiseArea: string;
  id: string;
  internalNotes: string[];
  issueSummary: string;
  lastUpdated: string;
  lifecycleStage: LifecycleStage;
  meetingLink?: string;
  operationalStatus: OperationalStatus;
  packageId?: string;
  paidAmount: number;
  priority: PriorityBadge;
  referenceCode: string;
  selectedServices: string[];
  stages: StageItem[];
  title: string;
  totalFee: number;
  urgency: UrgencyLevel;
}

export interface MatterPackage {
  createdAt: string;
  createdBy: string;
  description: string;
  displayOrder: number;
  features: string[];
  id: string;
  isRecommended: boolean;
  isSelected: boolean;
  matterId: string;
  name: string;
  price: number;
  currencyCode?: string;
  proposalStatus: MatterPackageProposalStatus;
  proposalVersion: number;
  publishedAt?: string;
  selectedAt?: string;
  services: string[];
  supersededAt?: string;
}

export interface InvoiceItem {
  amount: number;
  description: string;
  quantity: number;
  rate: number;
}

export interface Invoice {
  amount: number;
  clientId: string;
  clientName: string;
  currencyCode: string;
  discount: number;
  dueDate: string;
  id: string;
  issueDate: string;
  items: InvoiceItem[];
  matterId: string;
  matterRef: string;
  matterTitle: string;
  paidDate?: string;
  status: InvoiceStatus;
  tax: number;
  totalAmount: number;
}

export interface Payment {
  amount: number;
  clientId: string;
  clientName: string;
  id: string;
  invoiceId: string;
  matterId: string;
  method: 'online' | 'bank-transfer' | 'cash' | 'cheque';
  recordedBy: string;
  reference: string;
  status: 'success' | 'failed' | 'refunded';
  timestamp: string;
}

export interface PlatformEvent {
  actionCTA: string;
  calendarSyncError?: string;
  calendarSyncStatus?: 'cancelled' | 'disabled' | 'failed' | 'local' | 'pending' | 'synced';
  calendarSyncedAt?: string;
  calendarOwnerEmail?: string;
  clientId: string;
  clientName: string;
  googleAttendeeStatus?: string;
  date: string;
  duration: number;
  id: string;
  location?: string;
  matterId: string;
  matterTitle: string;
  meetConferenceId?: string;
  meetLink?: string;
  mode: ConsultationMode | 'court' | 'office';
  notes: string;
  reminderCount?: number;
  reminderStatus?: 'cancelled' | 'none' | 'scheduled';
  status: 'upcoming' | 'completed' | 'cancelled' | 'rescheduled';
  time: string;
  title: string;
  type: EventType;
  visibleToClient: boolean;
}

export interface PlatformDocument {
  clientId: string;
  clientName: string;
  docCategory: string;
  id: string;
  matterId: string;
  matterTitle: string;
  name: string;
  reviewState: DocReviewState;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
  visibility: 'client' | 'internal';
}

export interface MessageThread {
  assignedTo: string;
  clientId: string;
  clientName: string;
  id: string;
  lastMessage: string;
  lastMessageAt: string;
  matterId: string;
  matterRef: string;
  matterTitle: string;
  stage: LifecycleStage;
  status: 'active' | 'waiting' | 'resolved';
  unreadCount: number;
  urgency: UrgencyLevel;
}

export interface MessageAttachment {
  documentId: string;
  name: string;
}

export interface ChatMessage {
  attachments?: MessageAttachment[];
  content: string;
  id: string;
  read: boolean;
  senderId: string;
  senderName: string;
  senderRole: 'client' | 'admin' | 'system';
  threadId: string;
  timestamp: string;
}

export interface Advocate {
  activeAssignments: number;
  availability: 'available' | 'busy' | 'unavailable';
  avatar: string;
  expertise: string[];
  feeAgreed: number;
  feePaid: number;
  feePending: number;
  id: string;
  location: string;
  name: string;
  workload: 'light' | 'moderate' | 'heavy';
  yearsExperience: number;
}

export interface StaffMember {
  assignedMatters: number;
  avatar: string;
  id: string;
  name: string;
  role: string;
  status: 'active' | 'on-leave' | 'inactive';
  teamLead: string;
  workload: 'light' | 'moderate' | 'heavy';
}

export interface AuditEntry {
  action: string;
  actor: string;
  actorRole: AdminRole | 'client' | 'system';
  entityId: string;
  entityType: 'matter' | 'invoice' | 'payment' | 'document' | 'event' | 'user' | 'lead' | 'message';
  id: string;
  newValue?: string;
  oldValue?: string;
  sourceModule: string;
  timestamp: string;
}

export interface DashboardDocumentInput {
  name: string;
  size: number;
  type: string;
}

export interface DashboardRequestInput {
  caseDetails: string;
  consultationMode: ConsultationMode;
  documentUploadIds: string[];
  documents: DashboardDocumentInput[];
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

export interface RequestPricingConfig {
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

export interface DashboardSnapshot {
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
