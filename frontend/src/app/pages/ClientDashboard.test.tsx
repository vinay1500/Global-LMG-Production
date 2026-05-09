import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientDashboard } from './ClientDashboard';
import type { DashboardContextType } from '../contexts/DashboardContextStore';
import { useDashboard } from '../contexts/useDashboard';
import { useAuth } from '../contexts/useAuth';
import type { Invoice, Matter, PlatformUser } from '../data/dashboardTypes';
import { dashboardApi } from '../lib/api/dashboard';

const MockNewRequestWizard = vi.hoisted(() =>
  function MockNewRequestWizard({ isOpen }: { isOpen: boolean }) {
    return isOpen ? 'New request wizard loaded' : null;
  }
);

vi.mock('../components/NewRequestWizard', () => ({
  NewRequestWizard: MockNewRequestWizard,
}));

vi.mock('../contexts/useDashboard', () => ({
  useDashboard: vi.fn(),
}));

vi.mock('../contexts/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../lib/api/dashboard', () => ({
  dashboardApi: {
    buildInvoiceDownloadUrl: vi.fn((invoiceId: string) => `/api/v1/me/invoices/${invoiceId}/pdf`),
    createInvoicePaymentOrder: vi.fn(),
    getAccountSettings: vi.fn(),
    getInvoiceDetail: vi.fn(),
    verifyInvoicePayment: vi.fn(),
    verifyRequestPayment: vi.fn(),
  },
}));

const mockedUseDashboard = vi.mocked(useDashboard);
const mockedUseAuth = vi.mocked(useAuth);
const mockedDashboardApi = vi.mocked(dashboardApi);

const currentClient: PlatformUser = {
  avatar: '',
  countryCode: 'US',
  email: 'client@example.com',
  id: 'client-1',
  joinedAt: '2026-05-01T00:00:00.000Z',
  lastActiveAt: '2026-05-08T00:00:00.000Z',
  lifecycle: 'client',
  name: 'Client User',
  owner: 'Global LMG',
  phone: '+15555550100',
  region: 'United States',
};

const matter: Matter = {
  assignedCounsel: 'Counsel User',
  assignedStaff: 'Coordinator User',
  clientId: currentClient.id,
  clientName: currentClient.name,
  clientVisibleNotes: [
    'Initial review completed for a very long note that should remain readable in the client portal.',
  ],
  consultationMode: 'video',
  createdAt: '2026-05-01',
  currencyCode: 'USD',
  dueAmount: 120,
  expertiseArea: 'Commercial',
  id: 'matter-1',
  internalNotes: [],
  issueSummary:
    'This-is-a-deliberately-long-unbroken-matter-summary-used-to-prove-the-detail-view-renders-without-crashing-or-depending-on-live-APIs.',
  lastUpdated: '2026-05-08',
  lifecycleStage: 'consultation',
  operationalStatus: 'awaiting-payment',
  paidAmount: 0,
  priority: 'awaiting-client',
  referenceCode: 'MATTER-LONG-REFERENCE-2026-000000000000000000000001',
  selectedServices: ['litigation-monitoring'],
  stages: [
    { completed: true, id: 'request-received', label: 'Request received' },
    { completed: true, id: 'verification-call', label: 'Verified' },
    { completed: false, id: 'consultation', label: 'Consultation' },
    { completed: false, id: 'action-plan', label: 'Action plan' },
    { completed: false, id: 'resolution', label: 'Resolution' },
  ],
  title:
    'Matter with an extremely long title that should render safely in details without a layout-specific assertion',
  totalFee: 120,
  urgency: 'standard',
};

const payableInvoice: Invoice = {
  amount: 120,
  amountDue: 120,
  clientId: currentClient.id,
  clientName: currentClient.name,
  currencyCode: 'USD',
  discount: 0,
  dueDate: '2026-06-30',
  id: 'INV-PAYABLE',
  issueDate: '2026-06-01',
  items: [{ amount: 120, description: 'Document review', quantity: 1, rate: 120 }],
  matterId: matter.id,
  matterRef: matter.referenceCode,
  matterTitle: matter.title,
  paymentOptions: {
    allowsPartial: false,
    amountDue: 120,
    currencyCode: 'USD',
    minimumPaymentAmount: 50,
    offlineEnabled: true,
    onlineEnabled: true,
    payable: true,
    paymentDisabledReason: null,
    paymentProvider: 'razorpay',
    suggestedPaymentAmount: 120,
  },
  status: 'sent',
  tax: 0,
  totalAmount: 120,
};

const paidInvoice: Invoice = {
  ...payableInvoice,
  amountDue: 0,
  id: 'INV-PAID',
  paymentOptions: {
    ...payableInvoice.paymentOptions,
    amountDue: 0,
    onlineEnabled: false,
    payable: false,
    paymentDisabledReason: 'This invoice has already been paid.',
    paymentProvider: null,
    suggestedPaymentAmount: 0,
  },
  status: 'paid',
};

const createDashboardValue = (
  overrides: Partial<DashboardContextType> = {}
): DashboardContextType => ({
  advocates: [],
  auditEntries: [],
  currentClient,
  dismissNotification: vi.fn(),
  documents: [],
  errorMessage: null,
  events: [],
  invoices: [payableInvoice, paidInvoice],
  isLoading: false,
  isSavingPreferences: false,
  isSelectingPackage: false,
  isSendingMessage: false,
  isSubmittingRequest: false,
  isUploadingDocuments: false,
  leads: [],
  markNotificationRead: vi.fn(),
  markThreadRead: vi.fn(),
  matters: [matter],
  messages: [],
  notificationPreferences: {
    caseActivityAlerts: true,
    emailUpdates: true,
    inAppAlerts: true,
    invoiceReminders: true,
    productAnnouncements: false,
    smsAlerts: true,
  },
  notifications: [],
  packages: [],
  payments: [],
  reloadDashboard: vi.fn().mockResolvedValue(undefined),
  selectMatterPackage: vi.fn(),
  sendMessage: vi.fn(),
  staff: [],
  submitRequest: vi.fn(),
  threads: [],
  updateNotificationPreferences: vi.fn(),
  uploadDocuments: vi.fn(),
  users: [currentClient],
  ...overrides,
});

const renderDashboard = (initialPath = '/dashboard') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ClientDashboard />
    </MemoryRouter>
  );

beforeEach(() => {
  mockedUseAuth.mockReturnValue({
    currentUser: currentClient,
    isAuthenticated: true,
    isAuthReady: true,
    isAuthModalOpen: false,
    authMode: 'signin',
    closeAuthModal: vi.fn(),
    issueGoogleNonce: vi.fn(),
    openAuthModal: vi.fn(),
    requestPasswordReset: vi.fn(),
    resendEmailVerification: vi.fn(),
    resendPasswordReset: vi.fn(),
    resendPhoneOtp: vi.fn(),
    resetPassword: vi.fn(),
    setAuthMode: vi.fn(),
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    submitGooglePhone: vi.fn(),
    verifyEmail: vi.fn(),
    verifyPhoneOtp: vi.fn(),
  });
  mockedUseDashboard.mockReturnValue(createDashboardValue());
  mockedDashboardApi.getAccountSettings.mockResolvedValue({
    account: {
      address: {
        city: 'New York',
        countryCode: 'US',
        line1: '1 Main Street',
        line2: '',
        postalCode: '10001',
        sourceCode: 'manual',
        state: 'NY',
        validationStatusCode: 'manual',
      },
      email: currentClient.email,
      emailVerified: true,
      mobileNumber: currentClient.phone,
      name: currentClient.name,
      phone: currentClient.phone,
      phoneVerified: true,
    },
    deliveryAvailability: {
      email: 'available',
      portal: 'available',
      sms: 'available',
    },
  });
});

describe('ClientDashboard', () => {
  it('renders billing invoices from the dashboard snapshot and shows Pay Online only for payable invoices', () => {
    renderDashboard('/dashboard?panel=billing');

    expect(screen.getByRole('heading', { name: /billing & invoices/i })).toBeInTheDocument();
    expect(screen.getByText('INV-PAYABLE')).toBeInTheDocument();
    expect(screen.getByText('INV-PAID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pay online/i })).toBeInTheDocument();

    const paidRow = screen.getByText('INV-PAID').closest('tr');
    expect(paidRow).not.toBeNull();
    expect(within(paidRow as HTMLTableRowElement).queryByRole('button', { name: /pay online/i })).toBeNull();
  });

  it('renders matter detail safely with long text', async () => {
    const user = userEvent.setup();
    renderDashboard('/dashboard?panel=cases');

    await user.click(screen.getByText(matter.title));

    expect(screen.getByRole('heading', { name: matter.title })).toBeInTheDocument();
    expect(screen.getByText(matter.referenceCode)).toBeInTheDocument();
    expect(screen.getByText(matter.issueSummary)).toBeInTheDocument();
  });

  it('opens the lazy New Request wizard from the dashboard shell', async () => {
    const user = userEvent.setup();
    renderDashboard('/dashboard');

    await user.click(screen.getAllByRole('button', { name: /new request/i })[0]);

    await waitFor(() => expect(mockedDashboardApi.getAccountSettings).toHaveBeenCalled());
    expect(await screen.findByText('New request wizard loaded')).toBeInTheDocument();
  });
});
