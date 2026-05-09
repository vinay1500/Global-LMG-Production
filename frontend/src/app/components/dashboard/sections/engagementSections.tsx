import React from 'react';
import { Link } from 'react-router';
import {
  Bell,
  CreditCard,
  LogOut,
  MapPin,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  Settings,
  Shield,
  Smartphone,
  User,
} from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { formatCurrency, formatDate, formatDateTime } from '../../../utils/dashboardFormatting';
import { DEFAULT_COUNTRY, getCountryCode, getCountryName } from '../../../utils/countryDialCodes';
import { AddressForm, createEmptyAddressValue, type AddressFormValue } from '../../address/AddressForm';
import type {
  ChatMessage,
  Invoice,
  MessageThread,
  PlatformEvent,
  PlatformUser,
} from '../../../data/dashboardTypes';
import type { ClientAccountSettingsResponse, PortalNotificationResponse } from '../../../lib/api/contracts';

interface DashboardMessagesSectionProps {
  myThreads: MessageThread[];
  messages: ChatMessage[];
  selectedThread: string | null;
  messageInput: string;
  isSendingMessage: boolean;
  isUploadingAttachments: boolean;
  selectedAttachments: File[];
  threadSearchQuery: string;
  onSelectThread: (threadId: string) => void;
  onMessageInputChange: (value: string) => void;
  onThreadSearchQueryChange: (value: string) => void;
  onAttachmentSelect: (files: File[]) => void;
  onDownloadAttachment: (documentId: string) => void;
  onRemoveAttachment: (index: number) => void;
  onSendMessage: () => void;
}

export const DashboardMessagesSection = ({
  myThreads,
  messages,
  selectedThread,
  messageInput,
  isSendingMessage,
  isUploadingAttachments,
  selectedAttachments,
  threadSearchQuery,
  onSelectThread,
  onMessageInputChange,
  onThreadSearchQueryChange,
  onAttachmentSelect,
  onDownloadAttachment,
  onRemoveAttachment,
  onSendMessage,
}: DashboardMessagesSectionProps) => {
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const safeText = (value: string | null | undefined, fallback = '') => value || fallback;
  const filteredThreads = myThreads.filter((thread) => {
    if (!threadSearchQuery.trim()) {
      return true;
    }

    const query = threadSearchQuery.trim().toLowerCase();
    return (
      safeText(thread.matterTitle, 'General Support').toLowerCase().includes(query) ||
      safeText(thread.matterRef).toLowerCase().includes(query) ||
      safeText(thread.assignedTo, 'Client Intake Desk').toLowerCase().includes(query)
    );
  });
  const activeThread = selectedThread
    ? filteredThreads.find((thread) => thread.id === selectedThread) || filteredThreads[0]
    : filteredThreads[0];
  const threadMessages = messages.filter((message) => message.threadId === activeThread?.id);

  return (
    <div className="space-y-0">
      <h1 className="mb-4 text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
        Messages
      </h1>
      <div
        className="flex overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
        style={{ height: 'calc(100vh - 200px)', minHeight: 480 }}
      >
        <div className="hidden w-80 flex-shrink-0 overflow-y-auto border-r border-gray-100 md:block">
          <div className="border-b border-gray-100 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={threadSearchQuery}
                onChange={(event) => onThreadSearchQueryChange(event.target.value)}
                placeholder="Search conversations..."
                className="w-full rounded-lg border border-gray-100 bg-gray-50 py-2 pl-8 pr-3 text-xs"
              />
            </div>
          </div>
          {filteredThreads.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-gray-400">
              No conversations match your search.
            </div>
          ) : (
            filteredThreads.map((thread) => (
              <div
                key={thread.id}
                onClick={() => onSelectThread(thread.id)}
                className={`cursor-pointer border-b border-gray-50 px-4 py-3 transition hover:bg-gray-50 ${
                  activeThread?.id === thread.id ? 'border-l-2 border-l-gray-900 bg-blue-50/50' : ''
                }`}
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="flex-1 truncate text-sm">
                    {safeText(thread.matterTitle, 'General Support')}
                  </span>
                  {thread.unreadCount > 0 && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[10px] text-white">
                      {thread.unreadCount}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-gray-400">{thread.lastMessage}</p>
                <p className="mt-0.5 text-[10px] text-gray-300">{formatDateTime(thread.lastMessageAt)}</p>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-1 flex-col">
          {activeThread ? (
            <>
              <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3">
                <div>
                  <h3 className="text-sm">
                    {safeText(activeThread.matterTitle, 'General Support')}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {activeThread.matterRef || 'Inquiry'} ·{' '}
                    {safeText(activeThread.assignedTo, 'Client Intake Desk')}
                  </p>
                </div>
                <div className="ml-auto">
                  <StatusBadge status={activeThread.stage} />
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {threadMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.senderRole === 'client' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                        message.senderRole === 'client'
                          ? 'bg-gray-900 text-white'
                          : message.senderRole === 'system'
                            ? 'bg-gray-100 text-xs italic text-gray-500'
                            : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {message.senderRole !== 'client' && (
                        <p className="mb-0.5 text-[11px] text-gray-500">
                          {safeText(message.senderName, 'Global LMG')}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{safeText(message.content)}</p>
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {message.attachments.map((attachment, index) => (
                            <button
                              key={`${message.id}-${attachment.documentId}-${index}`}
                              type="button"
                              onClick={() => onDownloadAttachment(attachment.documentId)}
                              className={`rounded-full px-2.5 py-1 text-[11px] ${
                                message.senderRole === 'client'
                                  ? 'bg-white/15 text-white'
                                  : 'bg-white text-gray-600'
                              }`}
                            >
                              {attachment.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="mt-1 text-[10px] text-gray-400">{formatDateTime(message.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {selectedAttachments.length > 0 && (
                <div className="border-t border-dashed border-gray-100 px-5 py-3">
                  <div className="mb-2 flex flex-wrap gap-2">
                    {selectedAttachments.map((attachment, index) => (
                      <button
                        key={`${attachment.name}-${attachment.size}-${index}`}
                        type="button"
                        onClick={() => onRemoveAttachment(index)}
                        className="rounded-full bg-gray-100 px-3 py-1 text-[11px] text-gray-600 transition hover:bg-gray-200"
                      >
                        {attachment.name} x
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Attachments will be uploaded securely and sent with your next message.
                  </p>
                </div>
              )}
              <div className="flex gap-2 border-t border-gray-100 px-5 py-3">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  accept=".csv,.doc,.docx,.gif,.jpg,.jpeg,.pdf,.png,.txt,.webp,.xls,.xlsx,.zip"
                  className="hidden"
                  onChange={(event) => {
                    const files = event.target.files ? Array.from(event.target.files) : [];
                    if (files.length > 0) {
                      onAttachmentSelect(files);
                    }
                    event.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <input
                  value={messageInput}
                  disabled={isSendingMessage || isUploadingAttachments}
                  onChange={(event) => onMessageInputChange(event.target.value)}
                  placeholder={
                    isUploadingAttachments
                      ? 'Uploading attachments...'
                      : isSendingMessage
                        ? 'Sending message...'
                        : 'Type a message...'
                  }
                  className="flex-1 rounded-lg border border-gray-100 bg-gray-50 px-4 py-2 text-sm"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      onSendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={onSendMessage}
                  disabled={isSendingMessage || isUploadingAttachments}
                  className="rounded-lg bg-gray-900 p-2 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface DashboardNotificationsSectionProps {
  myInvoices: Invoice[];
  myEvents: PlatformEvent[];
  myThreads: MessageThread[];
  notifications: PortalNotificationResponse[];
  onOpenMessages: (threadId: string | null) => void;
  onOpenBilling: () => void;
  onActOnNotification: (
    notificationId: string,
    actionTarget: PortalNotificationResponse['actionTarget'],
    threadId: string | null
  ) => void;
}

export const DashboardNotificationsSection = ({
  myInvoices,
  myEvents,
  myThreads,
  notifications,
  onOpenMessages,
  onOpenBilling,
  onActOnNotification,
}: DashboardNotificationsSectionProps) => {
  const billingNotifications = myInvoices
    .filter((invoice) => ['pending', 'sent', 'overdue'].includes(invoice.status))
    .map((invoice) => ({
      id: `invoice-${invoice.id}`,
      type: invoice.status === 'overdue' ? 'Billing Alert' : 'Billing',
      title:
        invoice.status === 'overdue'
          ? `Invoice ${invoice.id} is overdue`
          : `Invoice ${invoice.id} is ready for review`,
      description: `${invoice.matterTitle} · ${formatCurrency(invoice.totalAmount, invoice.currencyCode)}`,
      timestamp: invoice.dueDate,
      timestampLabel: `Due ${formatDate(invoice.dueDate)}`,
      meta: `Due ${formatDate(invoice.dueDate)}`,
      actionLabel: 'Open Billing',
      onAction: onOpenBilling,
    }));
  const notificationItems = notifications.map((notification) => ({
    actionLabel: notification.actionLabel,
    description: notification.description,
    id: notification.id,
    isRead: notification.isRead,
    meta: notification.meta,
    onAction: () =>
      onActOnNotification(notification.id, notification.actionTarget, notification.threadId),
    timestamp: notification.createdAt,
    timestampLabel: formatDateTime(notification.createdAt),
    title: notification.title,
    type: notification.typeLabel,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Notifications
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Your notification center brings together unread messages, upcoming events, and billing
            reminders from your dashboard activity.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenMessages.bind(null, null)}
          className="inline-flex items-center gap-2 self-start rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          <MessageSquare className="h-4 w-4" /> Open Inbox
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label: 'Unread Messages',
            value: myThreads.reduce((sum, thread) => sum + thread.unreadCount, 0),
            accent: 'text-blue-600',
          },
          {
            label: 'Upcoming Events',
            value: myEvents.length,
            accent: 'text-indigo-600',
          },
          {
            label: 'Billing Alerts',
            value: billingNotifications.length,
            accent: 'text-amber-600',
          },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="mb-1 text-xs text-gray-500">{card.label}</p>
            <p className={`text-2xl ${card.accent}`} style={{ fontFamily: "'Playfair Display', serif" }}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {notificationItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            No notifications right now. New activity will show up here as soon as your cases,
            invoices, or messages change.
          </div>
        ) : (
          notificationItems.map((item) => (
            <div
              key={item.id}
              className={`rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md ${
                item.isRead ? 'border-gray-100 opacity-80' : 'border-gray-100'
              }`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-gray-500">
                      {item.type}
                    </span>
                    <span className="text-xs text-gray-400">{item.meta}</span>
                  </div>
                  <h3 className="text-sm text-gray-900">{item.title}</h3>
                  <p className="mt-1 text-sm text-gray-500">{item.description}</p>
                </div>
                <div className="flex flex-col items-start gap-3 sm:items-end">
                  <span className="text-xs text-gray-400">{item.timestampLabel}</span>
                  <button
                    type="button"
                    onClick={item.onAction}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    {item.actionLabel}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

interface DashboardSettingsSectionProps {
  user: PlatformUser;
  totalNotifications: number;
  preferences: {
    emailUpdates: boolean;
    inAppAlerts: boolean;
    smsAlerts: boolean;
    invoiceReminders: boolean;
    caseActivityAlerts: boolean;
    productAnnouncements: boolean;
  };
  onPreferenceChange: (
    key:
      | 'emailUpdates'
      | 'inAppAlerts'
      | 'smsAlerts'
      | 'invoiceReminders'
      | 'caseActivityAlerts'
      | 'productAnnouncements',
    value: boolean
  ) => void;
  accountSettings: ClientAccountSettingsResponse | null;
  accountSettingsError?: string | null;
  isAccountSettingsLoading?: boolean;
  onChangePassword: (payload: { currentPassword: string; newPassword: string }) => Promise<void>;
  onConfirmEmailChange: (payload: { code: string; email: string }) => Promise<ClientAccountSettingsResponse>;
  onConfirmPhoneChange: (payload: { code: string; phone: string }) => Promise<ClientAccountSettingsResponse>;
  onRefreshAccountSettings: () => Promise<void>;
  onRequestEmailChange: (payload: { email: string }) => Promise<{ deliveryHint?: string; deliveryStatus?: string }>;
  onRequestPhoneChange: (payload: { phone: string }) => Promise<{ deliveryHint?: string; deliveryStatus?: string }>;
  onUpdateName: (payload: { name: string }) => Promise<ClientAccountSettingsResponse>;
  onUpdateAddress: (payload: {
    city: string;
    country: string;
    googlePlaceId?: string | null;
    line1: string;
    line2?: string;
    postalCode: string;
    sourceCode?: 'google' | 'ip_prefill' | 'manual';
    state: string;
    validationStatusCode?: 'manual' | 'unverified' | 'verified';
  }) => Promise<ClientAccountSettingsResponse>;
  onOpenNotifications: () => void;
  onSignOut: () => void;
}

const toAccountAddressFormValue = (accountSettings: ClientAccountSettingsResponse): AddressFormValue => ({
  city: accountSettings.account.address.city,
  country: getCountryName(accountSettings.account.address.countryCode) || DEFAULT_COUNTRY,
  googlePlaceId: null,
  line1: accountSettings.account.address.line1,
  line2: accountSettings.account.address.line2,
  postalCode: accountSettings.account.address.postalCode,
  sourceCode: accountSettings.account.address.sourceCode,
  state: accountSettings.account.address.state,
  validationStatusCode: accountSettings.account.address.validationStatusCode,
});

const getAddressSignature = (address: AddressFormValue) =>
  JSON.stringify({
    city: address.city.trim(),
    countryCode: (getCountryCode(address.country) || address.country.trim()).toUpperCase(),
    line1: address.line1.trim(),
    line2: address.line2.trim(),
    postalCode: address.postalCode.trim(),
    sourceCode: address.sourceCode,
    state: address.state.trim(),
    validationStatusCode: address.validationStatusCode,
  });

type SettingsFeedbackSection = 'address' | 'communication' | 'email' | 'phone' | 'profile' | 'security';
type SettingsFeedback = {
  message: string;
  section: SettingsFeedbackSection;
  tone: 'error' | 'success' | 'warning';
};

const SettingsInlineAlert = ({ feedback }: { feedback: SettingsFeedback | null }) => {
  if (!feedback) {
    return null;
  }

  const toneClass =
    feedback.tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : feedback.tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${toneClass}`}>
      {feedback.message}
    </div>
  );
};

export const DashboardSettingsSection = ({
  user,
  totalNotifications,
  preferences,
  accountSettings,
  accountSettingsError,
  isAccountSettingsLoading = false,
  onChangePassword,
  onConfirmEmailChange,
  onConfirmPhoneChange,
  onRefreshAccountSettings,
  onRequestEmailChange,
  onRequestPhoneChange,
  onUpdateName,
  onUpdateAddress,
  onPreferenceChange,
  onOpenNotifications,
  onSignOut,
}: DashboardSettingsSectionProps) => {
  const [passwordForm, setPasswordForm] = React.useState({ currentPassword: '', newPassword: '' });
  const [nameForm, setNameForm] = React.useState({ name: accountSettings?.account.name || user.name });
  const [emailForm, setEmailForm] = React.useState({ code: '', email: '' });
  const [phoneForm, setPhoneForm] = React.useState({ code: '', phone: '' });
  const [addressForm, setAddressForm] = React.useState<AddressFormValue>({
    ...createEmptyAddressValue(DEFAULT_COUNTRY),
  });
  const [savedAddressSignature, setSavedAddressSignature] = React.useState('');
  const [feedback, setFeedback] = React.useState<SettingsFeedback | null>(null);
  const [isSavingAccount, setIsSavingAccount] = React.useState(false);

  React.useEffect(() => {
    if (!accountSettings) {
      return;
    }
    setNameForm({ name: accountSettings.account.name });
    setEmailForm((current) => ({ ...current, email: accountSettings.account.email }));
    setPhoneForm((current) => ({ ...current, phone: accountSettings.account.phone }));
    const nextAddressForm = toAccountAddressFormValue(accountSettings);
    setAddressForm(nextAddressForm);
    setSavedAddressSignature(getAddressSignature(nextAddressForm));
  }, [accountSettings]);

  const runAccountAction = async (
    section: SettingsFeedbackSection,
    action: () => Promise<void>
  ) => {
    setFeedback(null);
    setIsSavingAccount(true);
    try {
      await action();
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : 'We could not save that change right now. Please try again.',
        section,
        tone: 'error',
      });
    } finally {
      setIsSavingAccount(false);
    }
  };

  const showSuccess = (section: SettingsFeedbackSection, message: string) => {
    setFeedback({ message, section, tone: 'success' });
  };

  const deliveryAvailability = accountSettings?.deliveryAvailability;
  const emailDeliveryUnavailable = deliveryAvailability?.email === 'unavailable';
  const mobileVerificationUnavailable = deliveryAvailability?.sms === 'unavailable';
  const savedName = accountSettings?.account.name || user.name;
  const isNameDirty = nameForm.name.trim() !== savedName.trim();
  const isAddressDirty = getAddressSignature(addressForm) !== savedAddressSignature;

  const preferenceItems = [
    {
      key: 'inAppAlerts' as const,
      label: 'Portal notifications',
      description: 'Portal notifications for messages, billing, documents, events, and matter activity.',
      icon: Bell,
    },
    {
      key: 'emailUpdates' as const,
      label: 'Email updates',
      description: emailDeliveryUnavailable
        ? 'Email delivery is currently unavailable; this preference will apply once delivery is enabled.'
        : 'Matter progress, event reminders, and billing updates by email.',
      icon: Bell,
    },
    {
      key: 'smsAlerts' as const,
      label: 'SMS and phone alerts',
      description: mobileVerificationUnavailable
        ? 'SMS delivery is currently unavailable; this preference will apply once delivery is enabled.'
        : 'Urgent notices and verification-related mobile updates.',
      icon: Smartphone,
    },
    {
      key: 'invoiceReminders' as const,
      label: 'Invoice reminders',
      description: 'Reminders when an invoice is sent, due soon, or overdue.',
      icon: CreditCard,
    },
    {
      key: 'caseActivityAlerts' as const,
      label: 'Case activity alerts',
      description: 'Notifications when documents, notes, or milestones change.',
      icon: MessageSquare,
    },
    {
      key: 'productAnnouncements' as const,
      label: 'Service and account updates',
      description: 'Important account updates and information about improvements to your portal experience.',
      icon: Shield,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Settings
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Account security, verified contact details, and communication preferences for your portal profile.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenNotifications}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
        >
          <Bell className="h-4 w-4" /> Review Notifications ({totalNotifications})
        </button>
      </div>

      {accountSettingsError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {accountSettingsError}{' '}
          <button className="font-medium underline" onClick={() => void onRefreshAccountSettings()} type="button">
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <SettingsInlineAlert feedback={feedback?.section === 'profile' ? feedback : null} />
          <div className="mb-3 flex items-center gap-2 text-gray-900">
            <User className="h-4 w-4" />
            <h2 className="text-sm">Account Details</h2>
          </div>
          <div className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Name</p>
              <form
                className="mt-2 flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAccountAction('profile', async () => {
                    const nextSettings = await onUpdateName({ name: nameForm.name.trim() });
                    setNameForm({ name: nextSettings.account.name });
                    showSuccess('profile', 'Name saved.');
                  });
                }}
              >
                <input
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900"
                  disabled={isAccountSettingsLoading}
                  onChange={(event) => setNameForm({ name: event.target.value })}
                  value={nameForm.name}
                />
                <button
                  className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isSavingAccount || isAccountSettingsLoading || !nameForm.name.trim() || !isNameDirty}
                  type="submit"
                >
                  {isNameDirty ? 'Save' : 'Saved'}
                </button>
              </form>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Email</p>
              <p className="mt-1 text-gray-900">{accountSettings?.account.email || user.email}</p>
              <p className="text-xs text-gray-400">
                {accountSettings?.account.emailVerified ? 'Verified' : 'Verification pending'}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Phone</p>
              <p className="mt-1 text-gray-900">{accountSettings?.account.phone || user.phone}</p>
              <p className="text-xs text-gray-400">
                {accountSettings?.account.phoneVerified ? 'Verified' : 'Verification pending'}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-gray-900">
            <Bell className="h-4 w-4" />
            <h2 className="text-sm">Communication</h2>
          </div>
          <div className="space-y-2 text-sm text-gray-600">
            <p>Choose how you would like to receive matter, billing, document, and event updates.</p>
            <button
              className="text-xs font-medium text-gray-900 underline-offset-4 hover:underline"
              onClick={onOpenNotifications}
              type="button"
            >
              Review notification center
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-gray-900">
            <Shield className="h-4 w-4" />
            <h2 className="text-sm">Security</h2>
          </div>
          <p className="text-sm text-gray-600">
            Password changes require your current password. Email and phone changes become active only after verification.
          </p>
        </div>
      </div>

      <form
        className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void runAccountAction('address', async () => {
            const nextSettings = await onUpdateAddress({
              city: addressForm.city,
              country: getCountryCode(addressForm.country) || addressForm.country,
              googlePlaceId: addressForm.googlePlaceId || null,
              line1: addressForm.line1,
              line2: addressForm.line2,
              postalCode: addressForm.postalCode,
              sourceCode: addressForm.sourceCode,
              state: addressForm.state,
              validationStatusCode: addressForm.validationStatusCode,
            });
            const nextAddressForm = toAccountAddressFormValue(nextSettings);
            setAddressForm(nextAddressForm);
            setSavedAddressSignature(getAddressSignature(nextAddressForm));
            showSuccess('address', 'Billing address saved.');
          });
        }}
      >
        <SettingsInlineAlert feedback={feedback?.section === 'address' ? feedback : null} />
        <div className="flex items-center gap-2 text-gray-900">
          <MapPin className="h-4 w-4" />
          <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
            Billing Address
          </h2>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          This address controls the country used for new request pricing and invoice tax snapshots.
          Status: {addressForm.validationStatusCode === 'verified' ? 'verified' : addressForm.sourceCode === 'google' ? 'selected from Google, not yet verified' : 'manual'}.
        </p>
        <div className="mt-4">
          <AddressForm idPrefix="account-address" value={addressForm} onChange={setAddressForm} />
        </div>
        <button
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={
            isSavingAccount ||
            !isAddressDirty ||
            !addressForm.line1.trim() ||
            !addressForm.city.trim() ||
            !addressForm.state.trim() ||
            !addressForm.postalCode.trim()
          }
          type="submit"
        >
          {isAddressDirty ? 'Save Address' : 'Address Saved'}
        </button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void runAccountAction('security', async () => {
              await onChangePassword(passwordForm);
              setPasswordForm({ currentPassword: '', newPassword: '' });
              showSuccess('security', 'Password changed.');
            });
          }}
        >
          <SettingsInlineAlert feedback={feedback?.section === 'security' ? feedback : null} />
          <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
            Change Password
          </h2>
          <div className="mt-4 space-y-3">
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
              placeholder="Current password"
              type="password"
              value={passwordForm.currentPassword}
            />
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
              placeholder="New strong password"
              type="password"
              value={passwordForm.newPassword}
            />
            <button
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={isSavingAccount || !passwordForm.currentPassword || !passwordForm.newPassword}
              type="submit"
            >
              Save Password
            </button>
          </div>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <SettingsInlineAlert feedback={feedback?.section === 'email' ? feedback : null} />
          <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>Email Change</h2>
          <div className="mt-4 space-y-3">
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" onChange={(event) => setEmailForm((current) => ({ ...current, email: event.target.value }))} placeholder="New email" type="email" value={emailForm.email} />
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm" disabled={isSavingAccount || emailDeliveryUnavailable} onClick={() => void runAccountAction('email', async () => { const result = await onRequestEmailChange({ email: emailForm.email }); showSuccess('email', result.deliveryHint || 'Verification code sent to the new email.'); })} type="button">
                Send Code
              </button>
              <input className="min-w-32 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" onChange={(event) => setEmailForm((current) => ({ ...current, code: event.target.value }))} placeholder="Code" value={emailForm.code} />
              <button className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={isSavingAccount || !emailForm.code} onClick={() => void runAccountAction('email', async () => { await onConfirmEmailChange(emailForm); showSuccess('email', 'Email verified and updated.'); })} type="button">
                Confirm
              </button>
            </div>
            {emailDeliveryUnavailable ? <p className="text-xs text-amber-700">Email verification is temporarily unavailable.</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <SettingsInlineAlert feedback={feedback?.section === 'phone' ? feedback : null} />
          <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>Phone Change</h2>
          <div className="mt-4 space-y-3">
            <input className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" onChange={(event) => setPhoneForm((current) => ({ ...current, phone: event.target.value }))} placeholder="New phone" type="tel" value={phoneForm.phone} />
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border border-gray-200 px-4 py-2 text-sm" disabled={isSavingAccount || mobileVerificationUnavailable} onClick={() => void runAccountAction('phone', async () => { const result = await onRequestPhoneChange({ phone: phoneForm.phone }); showSuccess('phone', result.deliveryHint || 'Verification code sent to the new phone.'); })} type="button">
                Send Code
              </button>
              <input className="min-w-32 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" onChange={(event) => setPhoneForm((current) => ({ ...current, code: event.target.value }))} placeholder="Code" value={phoneForm.code} />
              <button className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={isSavingAccount || !phoneForm.code} onClick={() => void runAccountAction('phone', async () => { await onConfirmPhoneChange(phoneForm); showSuccess('phone', 'Phone verified and updated.'); })} type="button">
                Confirm
              </button>
            </div>
            {mobileVerificationUnavailable ? <p className="text-xs text-amber-700">Phone verification is temporarily unavailable.</p> : null}
          </div>
        </div>
      </div>

      {isAccountSettingsLoading ? <p className="text-sm text-gray-500">Loading account settings...</p> : null}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <SettingsInlineAlert feedback={feedback?.section === 'communication' ? feedback : null} />
        <div className="mb-5 flex items-center gap-2">
          <Settings className="h-4 w-4 text-gray-500" />
          <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
            Communication Preferences
          </h2>
        </div>

        <div className="space-y-4">
          {preferenceItems.map((preference) => {
            const Icon = preference.icon;
            const isEnabled = preferences[preference.key];

            return (
              <label
                key={preference.key}
                className="flex cursor-pointer items-start gap-4 rounded-xl border border-gray-100 px-4 py-4 transition hover:border-gray-200 hover:bg-gray-50/50"
              >
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                  <Icon className="h-4 w-4 text-gray-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{preference.label}</p>
                  <p className="mt-1 text-sm text-gray-500">{preference.description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(event) => {
                    onPreferenceChange(preference.key, event.target.checked);
                    showSuccess('communication', 'Communication preference saved.');
                  }}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-300"
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
            Legal and Privacy Controls
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Public legal documents remain available from inside the dashboard while your account settings remain securely managed.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/privacy" className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
              Privacy Policy
            </Link>
            <Link to="/legal-disclaimer" className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50">
              Legal Disclaimer
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-red-100 bg-red-50/60 p-6 shadow-sm">
          <h2 className="text-lg text-red-700" style={{ fontFamily: "'Playfair Display', serif" }}>
            Session Controls
          </h2>
          <p className="mt-2 text-sm text-red-700/80">
            Use sign out to clear the active secure portal session on this device.
          </p>
          <button type="button" onClick={onSignOut} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition hover:bg-red-700">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
