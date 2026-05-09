import { createContext } from 'react';
import type {
  Advocate,
  AuditEntry,
  ChatMessage,
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
} from '../data/dashboardTypes';
import type { RequestData } from '../data/requestWizardData';
import type {
  DashboardPackageSelectionResponse,
  DashboardRequestPaymentSubmissionResponse,
  NotificationPreferencesResponse,
  PortalNotificationResponse,
} from '../lib/api/contracts';

export interface DashboardContextType {
  currentClient: PlatformUser;
  matters: Matter[];
  invoices: Invoice[];
  documents: PlatformDocument[];
  events: PlatformEvent[];
  leads: Lead[];
  payments: Payment[];
  threads: MessageThread[];
  messages: ChatMessage[];
  packages: MatterPackage[];
  users: PlatformUser[];
  advocates: Advocate[];
  staff: StaffMember[];
  auditEntries: AuditEntry[];
  notificationPreferences: NotificationPreferencesResponse;
  notifications: PortalNotificationResponse[];
  isLoading: boolean;
  isSendingMessage: boolean;
  isSubmittingRequest: boolean;
  isSavingPreferences: boolean;
  isUploadingDocuments: boolean;
  isSelectingPackage: boolean;
  errorMessage: string | null;
  reloadDashboard: () => Promise<void>;
  submitRequest: (request: RequestData) => Promise<DashboardRequestPaymentSubmissionResponse>;
  sendMessage: (threadId: string, content: string, attachments?: File[]) => Promise<void>;
  markThreadRead: (threadId: string) => Promise<void>;
  selectMatterPackage: (
    matterId: string,
    matterPackageId: string,
    proposalVersion: number
  ) => Promise<DashboardPackageSelectionResponse>;
  uploadDocuments: (files: File[]) => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  dismissNotification: (notificationId: string) => Promise<void>;
  updateNotificationPreferences: (
    preferences: NotificationPreferencesResponse
  ) => Promise<void>;
}

export const DashboardContext = createContext<DashboardContextType | undefined>(undefined);
