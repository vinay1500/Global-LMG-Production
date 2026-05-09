import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AnimatePresence } from 'motion/react';
import {
  Bell,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  CreditCard,
  FileText,
  Folder,
  Plus,
  Search,
  Settings,
  Shield,
} from 'lucide-react';
import { Seo } from '../components/seo/Seo';
import { NewRequestWizard, type RequestData } from '../components/NewRequestWizard';
import {
  DashboardBillingSection,
  DashboardCasesSection,
  DashboardDocumentsSection,
  DashboardMessagesSection,
  DashboardNotificationsSection,
  DashboardOverviewSection,
  DashboardSettingsSection,
  InvoiceDetailSection,
  MatterDetailSection,
} from '../components/dashboard/sections';
import { BRAND_NAME } from '../config/brand';
import { useAuth } from '../contexts/useAuth';
import { useDashboard } from '../contexts/useDashboard';
import type { Matter } from '../data/dashboardTypes';
import type { ClientAccountSettingsResponse, InvoiceDetailResponse } from '../lib/api/contracts';
import { dashboardApi } from '../lib/api/dashboard';
import { uploadsApi } from '../lib/api/uploads';
import { buildWebPageJsonLd } from '../seo/jsonLd';

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  amount: number;
  currency: string;
  description: string;
  handler: (response: RazorpayCheckoutResponse) => void | Promise<void>;
  key: string;
  modal?: {
    ondismiss?: () => void;
  };
  name: string;
  order_id: string;
  prefill?: {
    contact?: string | null;
    email?: string;
    name?: string;
  };
  theme?: {
    color?: string;
  };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

let razorpayCheckoutScript: Promise<void> | null = null;

const loadRazorpayCheckout = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Online checkout is unavailable in this environment.'));
  }

  if (window.Razorpay) {
    return Promise.resolve();
  }

  if (!razorpayCheckoutScript) {
    razorpayCheckoutScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => {
        razorpayCheckoutScript = null;
        reject(new Error('Online checkout could not be loaded. Please try again.'));
      };
      document.body.appendChild(script);
    });
  }

  return razorpayCheckoutScript;
};

const DASHBOARD_TAB_IDS = [
  'dashboard',
  'cases',
  'documents',
  'billing',
  'messages',
  'notifications',
  'settings',
] as const;

type DashboardTabId = (typeof DASHBOARD_TAB_IDS)[number];

const SIDEBAR_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cases', label: 'My Cases', icon: Folder },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'billing', label: 'Billing & Invoices', icon: CreditCard },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const satisfies ReadonlyArray<{
  id: DashboardTabId;
  label: string;
  icon: typeof LayoutDashboard;
}>;

const isDashboardTabId = (value: string | null): value is DashboardTabId =>
  Boolean(value && DASHBOARD_TAB_IDS.includes(value as DashboardTabId));

export const ClientDashboard = () => {
  const { signOut } = useAuth();
  const {
    currentClient: user,
    matters,
    invoices,
    payments,
    documents,
    events,
    threads,
    messages,
    notifications,
    packages,
    notificationPreferences,
    isLoading,
    isSendingMessage,
    isUploadingDocuments,
    isSelectingPackage,
    errorMessage,
    reloadDashboard,
    submitRequest,
    sendMessage,
    markThreadRead,
    selectMatterPackage,
    uploadDocuments,
    markNotificationRead,
    dismissNotification,
    updateNotificationPreferences,
  } = useDashboard();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [selectedMatter, setSelectedMatter] = useState<Matter | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [messageThreadSearchQuery, setMessageThreadSearchQuery] = useState('');
  const [messageAttachments, setMessageAttachments] = useState<File[]>([]);
  const [threadReadInFlight, setThreadReadInFlight] = useState<string | null>(null);
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetailResponse | null>(null);
  const [invoiceDetailError, setInvoiceDetailError] = useState<string | null>(null);
  const [isLoadingInvoiceDetail, setIsLoadingInvoiceDetail] = useState(false);
  const [accountSettings, setAccountSettings] = useState<ClientAccountSettingsResponse | null>(null);
  const [accountSettingsError, setAccountSettingsError] = useState<string | null>(null);
  const [isLoadingAccountSettings, setIsLoadingAccountSettings] = useState(false);
  const requestedPanel = searchParams.get('panel');
  const activeTab: DashboardTabId = isDashboardTabId(requestedPanel)
    ? requestedPanel
    : 'dashboard';
  const selectedInvoiceId = activeTab === 'billing' ? searchParams.get('invoice') : null;

  // These filtered collections keep each dashboard panel focused on the signed-in client only.
  const myMatters = matters.filter((matter) => matter.clientId === user.id);
  const myInvoices = invoices.filter((invoice) => invoice.clientId === user.id);
  const myPayments = payments.filter((payment) => payment.clientId === user.id);
  const myEvents = events.filter(
    (event) => event.clientId === user.id && event.visibleToClient && event.status === 'upcoming'
  );
  const myDocs = documents.filter(
    (document) => document.clientId === user.id && document.visibility === 'client'
  );
  const myThreads = threads.filter((thread) => thread.clientId === user.id);
  const activeMatters = myMatters.filter(
    (matter) => matter.operationalStatus !== 'completed' && matter.operationalStatus !== 'archived'
  );
  const totalUnread = myThreads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  const totalNotifications = notifications.filter((notification) => !notification.isRead).length;
  const hasDashboardData =
    matters.length > 0 ||
    invoices.length > 0 ||
    documents.length > 0 ||
    events.length > 0 ||
    threads.length > 0 ||
    messages.length > 0;

  // Tab changes also normalize detail state so side panels do not leak between sections.
  const handleTabChange = (nextTab: DashboardTabId) => {
    setSelectedMatter(null);
    if (nextTab !== 'messages') {
      setSelectedThread(null);
      setMessageThreadSearchQuery('');
      setMessageAttachments([]);
    }
    setSidebarOpen(false);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('invoice');
    if (nextTab === 'dashboard') {
      nextParams.delete('panel');
    } else {
      nextParams.set('panel', nextTab);
    }
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (activeTab !== 'billing' || !selectedInvoiceId) {
      setInvoiceDetail(null);
      setInvoiceDetailError(null);
      setIsLoadingInvoiceDetail(false);
      return;
    }

    let cancelled = false;
    setIsLoadingInvoiceDetail(true);
    setInvoiceDetailError(null);

    void dashboardApi
      .getInvoiceDetail(selectedInvoiceId)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        setInvoiceDetail(detail);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setInvoiceDetail(null);
        setInvoiceDetailError(
          error instanceof Error ? error.message : 'We could not load that invoice right now.'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingInvoiceDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedInvoiceId]);

  const loadAccountSettings = useCallback(async () => {
    setIsLoadingAccountSettings(true);
    setAccountSettingsError(null);

    try {
      const nextSettings = await dashboardApi.getAccountSettings();
      setAccountSettings(nextSettings);
    } catch (error) {
      setAccountSettingsError(
        error instanceof Error ? error.message : 'We could not load account settings right now.'
      );
    } finally {
      setIsLoadingAccountSettings(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'settings') {
      void loadAccountSettings();
    }
  }, [activeTab, loadAccountSettings]);

  const handlePreferenceChange = (
    key: keyof typeof notificationPreferences,
    value: boolean
  ) => {
    void updateNotificationPreferences({
      ...notificationPreferences,
      [key]: value,
    });
  };

  // Case filters power the sidebar and search experience without mutating the stored matters.
  const filteredCases = myMatters.filter((matter) => {
    const matchSearch =
      !searchQuery ||
      matter.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      matter.referenceCode.toLowerCase().includes(searchQuery.toLowerCase());
    const matchFilter =
      caseFilter === 'all' ||
      (caseFilter === 'in-progress' &&
        [
          'work-in-progress',
          'consultation-scheduled',
          'consultation-completed',
          'fee-pending',
          'package-ready',
          'invoice-sent',
          'awaiting-payment',
          'paid',
          'awaiting-verification',
          'verification-scheduled',
          'new-lead',
        ].includes(matter.operationalStatus)) ||
        (caseFilter === 'immediate' && matter.urgency !== 'standard') ||
      (caseFilter === 'awaiting' &&
        (matter.operationalStatus === 'awaiting-client' ||
          matter.operationalStatus === 'fee-pending')) ||
      (caseFilter === 'completed' && matter.operationalStatus === 'completed');

    return matchSearch && matchFilter;
  });

  useEffect(() => {
    if (!selectedMatter) {
      return;
    }

    const refreshedMatter = myMatters.find((matter) => matter.id === selectedMatter.id);
    if (!refreshedMatter) {
      setSelectedMatter(null);
      return;
    }

    if (refreshedMatter !== selectedMatter) {
      setSelectedMatter(refreshedMatter);
    }
  }, [myMatters, selectedMatter]);

  const handleSelectMatter = (matter: Matter) => {
    setSelectedMatter(matter);
  };

  // Messaging and request submission are the two mutating actions in the portal shell.
  const handleOpenMessages = (threadId: string | null) => {
    handleTabChange('messages');
    setSelectedMatter(null);
    setSelectedThread(threadId);
    setMessageAttachments([]);
    setMessageThreadSearchQuery('');
  };

  const handleSelectThread = (threadId: string) => {
    setSelectedThread(threadId);
    const thread = myThreads.find((entry) => entry.id === threadId);

    if (thread?.unreadCount && threadReadInFlight !== threadId) {
      setThreadReadInFlight(threadId);
      void markThreadRead(threadId)
        .catch(() => undefined)
        .finally(() => setThreadReadInFlight(null));
    }
  };

  useEffect(() => {
    if (activeTab !== 'messages') {
      return;
    }

    const activeThreadId = selectedThread || myThreads[0]?.id;
    const activeThread = myThreads.find((thread) => thread.id === activeThreadId);

    if (!activeThread || activeThread.unreadCount <= 0 || threadReadInFlight === activeThread.id) {
      return;
    }

    setThreadReadInFlight(activeThread.id);
    void markThreadRead(activeThread.id)
      .catch(() => undefined)
      .finally(() => setThreadReadInFlight(null));
  }, [activeTab, selectedThread, myThreads, markThreadRead, threadReadInFlight]);

  const handleOpenBilling = () => {
    handleTabChange('billing');
  };

  const handleOpenInvoice = (invoiceId: string) => {
    setSelectedMatter(null);
    setSidebarOpen(false);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('panel', 'billing');
    nextParams.set('invoice', invoiceId);
    setSearchParams(nextParams, { replace: true });
  };

  const handleCloseInvoice = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('invoice');
    nextParams.set('panel', 'billing');
    setSearchParams(nextParams, { replace: true });
  };

  const handleOpenDocuments = () => {
    handleTabChange('documents');
  };

  const handleNewRequestSubmit = async (submission: RequestData) => {
    const result = await submitRequest(submission);
    await loadRazorpayCheckout();

    const RazorpayCheckout = window.Razorpay;
    if (!RazorpayCheckout) {
      throw new Error('Online checkout is unavailable. Please try again.');
    }

    await new Promise<void>((resolve, reject) => {
      const checkout = new RazorpayCheckout({
        amount: result.paymentOrder.amountMinor,
        currency: result.paymentOrder.currencyCode,
        description: `Request ${result.paymentOrder.requestNumber}`,
        handler: async (checkoutResponse) => {
          try {
            await dashboardApi.verifyRequestPayment(result.requestId, checkoutResponse);
            await reloadDashboard();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        key: result.paymentOrder.keyId,
        modal: {
          ondismiss: () => reject(new Error('Complete payment to submit your request.')),
        },
        name: BRAND_NAME,
        order_id: result.paymentOrder.orderId,
        prefill: {
          contact: result.paymentOrder.customer.phone,
          email: result.paymentOrder.customer.email,
          name: result.paymentOrder.customer.name,
        },
        theme: {
          color: '#111827',
        },
      });

      checkout.open();
    });
    setSelectedMatter(null);
    handleTabChange('cases');
    setSearchQuery('');
    setCaseFilter('all');
  };

  const handleOpenNewRequest = () => {
    if (!accountSettings && !isLoadingAccountSettings) {
      void loadAccountSettings().finally(() => setShowNewRequest(true));
      return;
    }

    setShowNewRequest(true);
  };

  const handleSendMessage = async () => {
    const activeThreadId = selectedThread || myThreads[0]?.id;

    if (
      !activeThreadId ||
      (!messageInput.trim() && messageAttachments.length === 0) ||
      isSendingMessage ||
      isUploadingDocuments
    ) {
      return;
    }

    await sendMessage(activeThreadId, messageInput, messageAttachments);
    setMessageInput('');
    setMessageAttachments([]);
  };

  const handleUploadDocuments = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    await uploadDocuments(files);
  };

  const handleDownloadDocument = (documentId: string) => {
    const downloadUrl = uploadsApi.buildDocumentDownloadUrl(documentId);
    window.open(downloadUrl, '_blank', 'noopener');
  };

  const handlePreviewDocument = (documentId: string) => {
    const previewUrl = uploadsApi.buildDocumentPreviewUrl(documentId);
    window.open(previewUrl, '_blank', 'noopener');
  };

  const handleDownloadInvoice = (invoiceId: string) => {
    const downloadUrl = dashboardApi.buildInvoiceDownloadUrl(invoiceId);
    window.open(downloadUrl, '_blank', 'noopener');
  };

  const handlePayInvoiceOnline = async (invoiceId: string, amount?: number | null) => {
    const order = await dashboardApi.createInvoicePaymentOrder(invoiceId, { amount });
    await loadRazorpayCheckout();

    const RazorpayCheckout = window.Razorpay;
    if (!RazorpayCheckout) {
      throw new Error('Online checkout is unavailable. Please try again.');
    }

    await new Promise<void>((resolve, reject) => {
      const checkout = new RazorpayCheckout({
        amount: order.amountMinor,
        currency: order.currencyCode,
        description: `Invoice ${order.invoiceNumber}`,
        handler: async (checkoutResponse) => {
          try {
            await dashboardApi.verifyInvoicePayment(invoiceId, checkoutResponse);
            const nextInvoice = await dashboardApi.getInvoiceDetail(invoiceId);
            setInvoiceDetail(nextInvoice);
            await reloadDashboard();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        key: order.keyId,
        modal: {
          ondismiss: () => reject(new Error('Payment window closed before completion.')),
        },
        name: BRAND_NAME,
        order_id: order.orderId,
        prefill: {
          contact: order.customer.phone,
          email: order.customer.email,
          name: order.customer.name,
        },
        theme: {
          color: '#111827',
        },
      });

      checkout.open();
    });
  };

  const handleOpenMatterFromInvoice = (matterId: string | null) => {
    if (!matterId) {
      return;
    }

    const relatedMatter = myMatters.find((matter) => matter.id === matterId);

    if (!relatedMatter) {
      handleTabChange('cases');
      return;
    }

    setSelectedMatter(relatedMatter);
    setSelectedThread(null);
    setMessageThreadSearchQuery('');
    setMessageAttachments([]);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('panel', 'cases');
    nextParams.delete('invoice');
    setSearchParams(nextParams, { replace: true });
  };

  const handlePayInvoice = (invoiceId: string) => {
    const invoice = myInvoices.find((entry) => entry.id === invoiceId);

    if (invoice?.matterId) {
      const relatedMatter = myMatters.find((matter) => matter.id === invoice.matterId);
      if (relatedMatter) {
        setSelectedMatter(relatedMatter);
        return;
      }
    }

    handleOpenBilling();
  };

  const handleSelectPackage = async (
    matterId: string,
    matterPackageId: string,
    proposalVersion: number
  ) => {
    try {
      const response = await selectMatterPackage(matterId, matterPackageId, proposalVersion);
      handleOpenInvoice(response.generatedInvoiceId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'We could not confirm that package.');
    }
  };

  const handleNotificationAction = async (
    notificationId: string,
    action: () => void | Promise<void>
  ) => {
    await markNotificationRead(notificationId);
    await dismissNotification(notificationId);
    await action();
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1000000) {
      return `${(bytes / 1000000).toFixed(1)} MB`;
    }

    return `${(bytes / 1000).toFixed(0)} KB`;
  };

  if (isLoading && !hasDashboardData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-6 py-16">
        <div className="max-w-md rounded-[2rem] border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Loading your dashboard
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            We are loading your matters, documents, billing, and messages.
          </p>
        </div>
      </div>
    );
  }

  if (errorMessage && !hasDashboardData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-6 py-16">
        <div className="max-w-md rounded-[2rem] border border-red-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Dashboard unavailable
          </h1>
          <p className="mt-3 text-sm text-gray-500">{errorMessage}</p>
          <button
            type="button"
            onClick={() => {
              void reloadDashboard();
            }}
            className="mt-6 rounded-full bg-gray-900 px-5 py-3 text-sm text-white hover:bg-black"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // The main content switch keeps all dashboard panels behind one shell and one route.
  const renderContent = () => {
    if (activeTab === 'billing' && selectedInvoiceId) {
      return (
        <InvoiceDetailSection
          errorMessage={invoiceDetailError}
          invoice={invoiceDetail}
          isLoading={isLoadingInvoiceDetail}
          onBack={handleCloseInvoice}
          onDownloadInvoice={handleDownloadInvoice}
          onOpenMatter={handleOpenMatterFromInvoice}
          onPayOnline={handlePayInvoiceOnline}
        />
      );
    }

    if (selectedMatter) {
      return (
        <MatterDetailSection
          activeTab={activeTab}
          isSelectingPackage={isSelectingPackage}
          matterPackages={packages.filter((entry) => entry.matterId === selectedMatter.id)}
          selectedMatter={selectedMatter}
          myInvoices={myInvoices}
          myDocs={myDocs}
          myEvents={myEvents}
          myThreads={myThreads}
          onBack={() => setSelectedMatter(null)}
          onDownloadDocument={handleDownloadDocument}
          onPreviewDocument={handlePreviewDocument}
          onOpenBilling={handleOpenBilling}
          onOpenInvoice={handleOpenInvoice}
          onOpenMessagesForMatter={handleOpenMessages}
          onSelectPackage={handleSelectPackage}
          formatSize={formatSize}
        />
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardOverviewSection
            user={user}
            billingCountryCode={accountSettings?.account.address.countryCode || user.countryCode}
            activeMatters={activeMatters}
            myEvents={myEvents}
            totalUnread={totalUnread}
            myInvoices={myInvoices}
            myMatters={myMatters}
            myThreads={myThreads}
            onOpenNewRequest={handleOpenNewRequest}
            onOpenBilling={() => handleTabChange('billing')}
            onViewAllCases={() => handleTabChange('cases')}
            onSelectMatter={handleSelectMatter}
            onOpenMessages={handleOpenMessages}
          />
        );
      case 'cases':
        return (
          <DashboardCasesSection
            filteredCases={filteredCases}
            searchQuery={searchQuery}
            caseFilter={caseFilter}
            onSearchQueryChange={setSearchQuery}
            onCaseFilterChange={setCaseFilter}
            onOpenNewRequest={handleOpenNewRequest}
            onSelectMatter={handleSelectMatter}
          />
        );
      case 'documents':
        return (
          <DashboardDocumentsSection
            myDocs={myDocs}
            myMatters={myMatters}
            formatSize={formatSize}
            isUploadingDocuments={isUploadingDocuments}
            onDownloadDocument={handleDownloadDocument}
            onPreviewDocument={handlePreviewDocument}
            onUploadDocuments={(files) => {
              void handleUploadDocuments(files);
            }}
          />
        );
      case 'billing':
        return (
          <DashboardBillingSection
            myInvoices={myInvoices}
            myPayments={myPayments}
            onDownloadInvoice={handleDownloadInvoice}
            onPayInvoice={handlePayInvoice}
            onViewInvoice={handleOpenInvoice}
          />
        );
      case 'messages':
        return (
          <DashboardMessagesSection
            myThreads={myThreads}
            messages={messages}
            selectedThread={selectedThread}
            messageInput={messageInput}
            isSendingMessage={isSendingMessage}
            isUploadingAttachments={isUploadingDocuments}
            selectedAttachments={messageAttachments}
            threadSearchQuery={messageThreadSearchQuery}
            onSelectThread={handleSelectThread}
            onMessageInputChange={setMessageInput}
            onThreadSearchQueryChange={setMessageThreadSearchQuery}
            onAttachmentSelect={(files) =>
              setMessageAttachments((current) => [...current, ...files])
            }
            onDownloadAttachment={handleDownloadDocument}
            onRemoveAttachment={(index) =>
              setMessageAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))
            }
            onSendMessage={() => {
              void handleSendMessage();
            }}
          />
        );
      case 'notifications':
        return (
          <DashboardNotificationsSection
            myThreads={myThreads}
            myEvents={myEvents}
            myInvoices={myInvoices}
            notifications={notifications}
            onOpenMessages={handleOpenMessages}
            onOpenBilling={handleOpenBilling}
            onOpenCases={() => handleTabChange('cases')}
            onOpenDocuments={handleOpenDocuments}
            onActOnNotification={(notificationId, actionTarget, threadId) => {
              void handleNotificationAction(notificationId, async () => {
                switch (actionTarget) {
                  case 'messages':
                    handleOpenMessages(threadId);
                    return;
                  case 'billing':
                    handleOpenBilling();
                    return;
                  case 'documents':
                    handleOpenDocuments();
                    return;
                  default:
                    handleTabChange('cases');
                }
              });
            }}
          />
        );
      case 'settings':
        return (
          <DashboardSettingsSection
            accountSettings={accountSettings}
            accountSettingsError={accountSettingsError}
            isAccountSettingsLoading={isLoadingAccountSettings}
            user={user}
            totalNotifications={totalNotifications}
            preferences={notificationPreferences}
            onChangePassword={async (payload) => {
              await dashboardApi.changePassword(payload);
            }}
            onConfirmEmailChange={async (payload) => {
              const nextSettings = await dashboardApi.confirmEmailChange(payload);
              setAccountSettings(nextSettings);
              await reloadDashboard();
              return nextSettings;
            }}
            onConfirmPhoneChange={async (payload) => {
              const nextSettings = await dashboardApi.confirmPhoneChange(payload);
              setAccountSettings(nextSettings);
              await reloadDashboard();
              return nextSettings;
            }}
            onPreferenceChange={handlePreferenceChange}
            onOpenNotifications={() => handleTabChange('notifications')}
            onRefreshAccountSettings={loadAccountSettings}
            onRequestEmailChange={(payload) => dashboardApi.requestEmailChange(payload)}
            onRequestPhoneChange={(payload) => dashboardApi.requestPhoneChange(payload)}
            onUpdateName={async (payload) => {
              const nextSettings = await dashboardApi.updateAccountName(payload);
              setAccountSettings(nextSettings);
              await reloadDashboard();
              return nextSettings;
            }}
            onUpdateAddress={async (payload) => {
              const nextSettings = await dashboardApi.updateAccountAddress(payload);
              setAccountSettings(nextSettings);
              await reloadDashboard();
              return nextSettings;
            }}
            onSignOut={signOut}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <Seo
        title="Client Dashboard"
        description={`${BRAND_NAME} client dashboard for matter tracking, documents, billing, and messages.`}
        path="/dashboard"
        robots="noindex, nofollow"
        structuredData={buildWebPageJsonLd({
          title: `${BRAND_NAME} Client Dashboard`,
          description: `${BRAND_NAME} client dashboard for matter tracking, documents, billing, and messages.`,
          path: '/dashboard',
        })}
      />

      {/* Sticky dashboard header keeps global actions accessible while the workspace scrolls. */}
      <div className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              className="rounded-lg p-2 hover:bg-gray-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <span
                className="hidden text-sm sm:block"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {BRAND_NAME}
              </span>
              <span className="hidden text-xs text-gray-400 sm:block">Client Dashboard</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                placeholder="Search dashboard..."
                className="w-56 rounded-lg border border-gray-100 bg-gray-50 py-2 pl-9 pr-4 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => handleTabChange('notifications')}
              className={`relative rounded-lg p-2 transition ${
                activeTab === 'notifications' && !selectedMatter
                  ? 'bg-gray-100'
                  : 'hover:bg-gray-100'
              }`}
            >
              <Bell className="h-5 w-5 text-gray-500" />
              {totalNotifications > 0 && (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {totalNotifications}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 border-l border-gray-100 pl-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-xs text-white">
                {user.name.charAt(0)}
              </div>
              <span className="hidden text-sm md:block">{user.name}</span>
            </div>
          </div>
        </div>
        {errorMessage && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 lg:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-amber-800">{errorMessage}</p>
              <button
                type="button"
                onClick={() => {
                  void reloadDashboard();
                }}
                className="self-start rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Refresh dashboard
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar navigation and workspace content stay separate so future panels can scale cleanly. */}
      <div className="flex">
        <aside
          className={`fixed left-0 top-[57px] z-20 h-[calc(100vh-57px)] w-64 transform border-r border-gray-100 bg-white transition-transform lg:sticky lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex h-full flex-col">
            <nav className="space-y-1 p-4">
              {SIDEBAR_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id && !selectedMatter;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition ${
                      isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                    {tab.label}
                    {(tab.id === 'messages' || tab.id === 'notifications') &&
                      (tab.id === 'messages' ? totalUnread : totalNotifications) > 0 && (
                      <span
                        className={`ml-auto flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                          isActive ? 'bg-white text-gray-900' : 'bg-gray-900 text-white'
                        }`}
                      >
                        {tab.id === 'messages' ? totalUnread : totalNotifications}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  handleOpenNewRequest();
                  setSidebarOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-gray-200 px-4 py-2.5 text-sm text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
              >
                <Plus className="h-4.5 w-4.5" />
                New Request
              </button>
            </nav>

            <div className="mt-auto space-y-2 border-t border-gray-100 p-4">
              <Link
                to="/"
                className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900"
              >
                <Home className="h-4.5 w-4.5" /> Back to Website
              </Link>
              <button
                type="button"
                onClick={() => {
                  void signOut();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4.5 w-4.5" /> Sign out
              </button>
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-10 bg-black/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="min-w-0 flex-1 p-4 lg:p-8">{renderContent()}</main>
      </div>

      {/* The request wizard remains modal-based so it can be opened from multiple dashboard panels. */}
      <AnimatePresence>
        {showNewRequest && (
          <NewRequestWizard
            isOpen={showNewRequest}
            onClose={() => setShowNewRequest(false)}
            onOpenSettings={() => {
              setShowNewRequest(false);
              handleTabChange('settings');
            }}
            onSubmit={handleNewRequestSubmit}
            userName={accountSettings?.account.name || user.name}
            userEmail={accountSettings?.account.email || user.email}
            userMobile={accountSettings?.account.mobileNumber || accountSettings?.account.phone || user.phone}
            billingCountryCode={accountSettings?.account.address.countryCode || user.countryCode}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
