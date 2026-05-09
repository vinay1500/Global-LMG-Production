export type LifecycleStage =
  | 'request-received'
  | 'verification-call'
  | 'consultation'
  | 'action-plan'
  | 'resolution';

export type OperationalStatus =
  | 'new-lead'
  | 'awaiting-verification'
  | 'verification-scheduled'
  | 'verification-done'
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

export type PriorityBadge =
  | 'in-progress'
  | 'immediate-6h'
  | 'awaiting-client'
  | 'awaiting-team'
  | 'completed'
  | 'on-hold';

export type UserLifecycle =
  | 'registered'
  | 'lead'
  | 'consultation-scheduled'
  | 'consultation-completed'
  | 'fee-pending'
  | 'client'
  | 'archived';

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'pending'
  | 'paid'
  | 'overdue'
  | 'failed'
  | 'refunded'
  | 'void';

export type MatterPackageProposalStatus =
  | 'draft'
  | 'published'
  | 'selected'
  | 'superseded'
  | 'archived';

export type EventType =
  | 'verification-call'
  | 'consultation'
  | 'hearing'
  | 'field-visit'
  | 'deadline'
  | 'reminder';

export type ConsultationMode = string;

export type AdminRole =
  | 'super-admin'
  | 'management'
  | 'billing-admin'
  | 'case-manager'
  | 'messaging-desk'
  | 'team-coordinator';

export type DocReviewState = 'unreviewed' | 'reviewed' | 'requires-revision';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  countryCode?: string;
  avatar: string;
  lifecycle: UserLifecycle;
  joinedAt: string;
  lastActiveAt: string;
  owner?: string;
  region?: string;
}

export interface Lead {
  id: string;
  userId: string;
  status:
    | 'new-lead'
    | 'submitted'
    | 'awaiting-verification'
    | 'consultation-scheduled'
    | 'consultation-completed'
    | 'fee-pending'
    | 'converted'
    | 'lost-closed';
  selectedServices: string[];
  expertiseArea: string;
  urgency: string;
  consultationMode: ConsultationMode;
  preferredSlot: string;
  issueSummary: string;
  createdAt: string;
  assignedOwner: string;
  paymentStatus: 'none' | 'invoice-sent' | 'paid' | 'overdue';
  consultationStatus: 'not-scheduled' | 'scheduled' | 'completed' | 'cancelled';
  notes: string;
}

export interface StageItem {
  id: LifecycleStage;
  label: string;
  completed: boolean;
}

export interface Matter {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  referenceCode: string;
  lifecycleStage: LifecycleStage;
  stages: StageItem[];
  operationalStatus: OperationalStatus;
  priority: PriorityBadge;
  selectedServices: string[];
  expertiseArea: string;
  issueSummary: string;
  urgency: string;
  consultationMode: ConsultationMode;
  assignedCounsel?: string;
  assignedStaff?: string;
  assignments?: Array<{
    id: string;
    name: string;
    type: 'external_counsel' | 'field_partner' | 'internal_staff';
    visibleToClient: boolean;
  }>;
  packageId?: string;
  totalFee: number;
  paidAmount: number;
  dueAmount: number;
  meetingLink?: string;
  createdAt: string;
  lastUpdated: string;
  clientVisibleNotes: string[];
  internalNotes: string[];
  currencyCode?: string;
}

export interface MatterPackage {
  id: string;
  matterId: string;
  name: string;
  description: string;
  services: string[];
  price: number;
  currencyCode?: string;
  createdBy: string;
  createdAt: string;
  displayOrder: number;
  features: string[];
  isRecommended: boolean;
  isSelected: boolean;
  proposalStatus: MatterPackageProposalStatus;
  proposalVersion: number;
  publishedAt?: string;
  selectedAt?: string;
  supersededAt?: string;
}

export interface Invoice {
  id: string;
  matterId: string;
  matterRef: string;
  matterTitle: string;
  clientId: string;
  clientName: string;
  currencyCode: string;
  amount: number;
  tax: number;
  discount: number;
  totalAmount: number;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  paidDate?: string;
  items: Array<{ description: string; quantity: number; rate: number; amount: number }>;
}

export interface Payment {
  id: string;
  invoiceId: string;
  matterId: string;
  clientId: string;
  clientName: string;
  amount: number;
  method: 'online' | 'bank-transfer' | 'cash' | 'cheque';
  status: 'success' | 'failed' | 'refunded';
  timestamp: string;
  recordedBy: string;
  reference: string;
}

export interface PlatformEvent {
  id: string;
  title: string;
  type: EventType;
  calendarSyncError?: string;
  calendarSyncStatus?: 'cancelled' | 'disabled' | 'failed' | 'local' | 'pending' | 'synced';
  calendarSyncedAt?: string;
  calendarOwnerEmail?: string;
  clientId: string;
  clientName: string;
  googleAttendeeStatus?: string;
  matterId: string;
  matterTitle: string;
  meetConferenceId?: string;
  date: string;
  time: string;
  duration: number;
  mode: ConsultationMode | 'court' | 'office';
  location?: string;
  meetLink?: string;
  visibleToClient: boolean;
  actionCTA: string;
  notes: string;
  reminderCount?: number;
  reminderStatus?: 'cancelled' | 'none' | 'scheduled';
  status: 'upcoming' | 'completed' | 'cancelled' | 'rescheduled';
}

export interface PlatformDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  matterId: string;
  matterTitle: string;
  clientId: string;
  clientName: string;
  uploadedBy: string;
  uploadedAt: string;
  visibility: 'client' | 'internal';
  reviewState: DocReviewState;
  virusStatus?: string;
  docCategory: string;
}

export interface MessageThread {
  id: string;
  clientId: string;
  clientName: string;
  matterId: string;
  matterTitle: string;
  matterRef: string;
  stage: LifecycleStage;
  urgency: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  assignedTo: string;
  status: 'active' | 'waiting' | 'resolved';
}

export interface MessageAttachment {
  documentId: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: 'client' | 'admin' | 'system';
  content: string;
  timestamp: string;
  read: boolean;
  attachments?: MessageAttachment[];
}

export interface Advocate {
  id: string;
  name: string;
  location: string;
  expertise: string[];
  yearsExperience: number;
  activeAssignments: number;
  workload: 'light' | 'moderate' | 'heavy';
  availability: 'available' | 'busy' | 'unavailable';
  feeAgreed: number;
  feePaid: number;
  feePending: number;
  avatar: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  assignedMatters: number;
  workload: 'light' | 'moderate' | 'heavy';
  status: 'active' | 'on-leave' | 'inactive';
  teamLead: string;
  avatar: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: AdminRole | 'client' | 'system';
  entityType: 'matter' | 'invoice' | 'payment' | 'document' | 'event' | 'user' | 'lead' | 'message';
  entityId: string;
  action: string;
  oldValue?: string;
  newValue?: string;
  sourceModule: string;
}
