import React from 'react';
import {
  Calendar,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Eye,
  FileText,
  Folder,
  Plus,
  Search,
  Upload,
  Video,
} from 'lucide-react';
import { LifecycleStepper } from '../LifecycleStepper';
import { StatusBadge, UrgencyDot } from '../StatusBadge';
import { formatCurrency, formatDate } from '../../../utils/dashboardFormatting';
import { getGreetingForCountry } from '../../../utils/localGreeting';
import type {
  Invoice,
  Matter,
  MessageThread,
  Payment,
  PlatformDocument,
  PlatformEvent,
  PlatformUser,
} from '../../../data/dashboardTypes';

interface DashboardOverviewSectionProps {
  user: PlatformUser;
  billingCountryCode?: string | null;
  activeMatters: Matter[];
  myEvents: PlatformEvent[];
  totalUnread: number;
  myInvoices: Invoice[];
  myMatters: Matter[];
  myThreads: MessageThread[];
  onOpenNewRequest: () => void;
  onOpenBilling: () => void;
  onViewAllCases: () => void;
  onSelectMatter: (matter: Matter) => void;
  onOpenMessages: (threadId: string | null) => void;
}

export const DashboardOverviewSection = ({
  user,
  billingCountryCode,
  activeMatters,
  myEvents,
  totalUnread,
  myInvoices,
  myMatters,
  myThreads,
  onOpenNewRequest,
  onOpenBilling,
  onViewAllCases,
  onSelectMatter,
  onOpenMessages,
}: DashboardOverviewSectionProps) => (
  <div className="space-y-8">
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-[#1a1a3e] p-8 text-white lg:p-10">
      <div className="absolute right-0 top-0 -mr-20 -mt-20 h-64 w-64 rounded-full bg-white/5" />
      <div className="relative">
        <p className="mb-1 text-gray-400">{getGreetingForCountry(billingCountryCode || user.countryCode)},</p>
        <h1 className="text-3xl lg:text-4xl" style={{ fontFamily: "'Playfair Display', serif" }}>
          {user.name}
        </h1>
        <p className="mb-6 mt-3 max-w-xl text-gray-300">
          You have{' '}
          <strong className="text-white">
            {activeMatters.length} active matter{activeMatters.length !== 1 ? 's' : ''}
          </strong>{' '}
          and{' '}
          <strong className="text-white">
            {myEvents.length} upcoming event{myEvents.length !== 1 ? 's' : ''}
          </strong>
          .
          {totalUnread > 0 && (
            <>
              {' '}
              You have{' '}
              <strong className="text-amber-400">
                {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
              </strong>
              .
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onOpenNewRequest}
            className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-gray-900 transition hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" /> New Request
          </button>
          <button
            type="button"
            onClick={onOpenBilling}
            className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-5 py-2.5 text-white transition hover:bg-white/20"
          >
            <CreditCard className="h-4 w-4" /> View Invoices
          </button>
        </div>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[
        { label: 'Active Matters', value: activeMatters.length, color: 'text-blue-600' },
        {
          label: 'Pending Invoices',
          value: myInvoices.filter(
            (invoice) => invoice.status === 'pending' || invoice.status === 'sent'
          ).length,
          color: 'text-amber-600',
        },
        {
          label: 'Total Paid',
          value: formatCurrency(
            myInvoices
              .filter((invoice) => invoice.status === 'paid')
              .reduce((sum, invoice) => sum + invoice.totalAmount, 0),
            myInvoices[0]?.currencyCode || activeMatters[0]?.currencyCode || 'USD'
          ),
          color: 'text-emerald-600',
        },
        { label: 'Upcoming Events', value: myEvents.length, color: 'text-indigo-600' },
      ].map((card) => (
        <div key={card.label} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="mb-1 text-xs text-gray-500">{card.label}</p>
          <p className={`text-2xl ${card.color}`} style={{ fontFamily: "'Playfair Display', serif" }}>
            {card.value}
          </p>
        </div>
      ))}
    </div>

    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
          Active Matters
        </h2>
        <button
          type="button"
          onClick={onViewAllCases}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          View All <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-4">
        {activeMatters.slice(0, 3).map((matter) => (
          <div
            key={matter.id}
            className="max-w-full overflow-hidden rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 break-words text-sm sm:truncate">{matter.title}</h3>
                  <span className="break-all text-[11px] text-gray-400">{matter.referenceCode}</span>
                  <StatusBadge status={matter.operationalStatus} />
                  <UrgencyDot urgency={matter.urgency} />
                </div>
                <p className="mb-3 break-words text-xs text-gray-500">{matter.issueSummary}</p>
                <div className="max-w-full overflow-x-auto pb-2 sm:max-w-md">
                  <div className="min-w-[24rem] sm:min-w-0">
                    <LifecycleStepper stages={matter.stages} />
                  </div>
                </div>
                {matter.clientVisibleNotes.length > 0 && (
                  <p className="mt-3 break-words rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    <span className="text-gray-400">Latest:</span>{' '}
                    {matter.clientVisibleNotes[matter.clientVisibleNotes.length - 1]}
                  </p>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={() => onSelectMatter(matter)}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-gray-800"
                >
                  View Details
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onOpenMessages(
                      myThreads.find((thread) => thread.matterId === matter.id)?.id || null
                    )
                  }
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                >
                  Chat
                </button>
                {matter.dueAmount > 0 && (
                  <button
                    type="button"
                    onClick={onOpenBilling}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
                  >
                    View Billing {formatCurrency(matter.dueAmount, matter.currencyCode || 'USD')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

    {myEvents.length > 0 && (
      <div>
        <h2 className="mb-4 text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
          Upcoming
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {myEvents.map((event) => (
            <div key={event.id} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-start justify-between">
                <StatusBadge status={event.type} />
                <UrgencyDot
                  urgency={myMatters.find((matter) => matter.id === event.matterId)?.urgency || 'standard'}
                />
              </div>
              <h3 className="mb-1 text-sm">{event.title}</h3>
              <p className="mb-3 text-xs text-gray-500">{event.matterTitle}</p>
              <div className="space-y-1 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(event.date)}
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {event.time} ({event.duration} min)
                </div>
                {event.location && <div className="flex items-center gap-1.5">{event.location}</div>}
              </div>
              {event.meetLink && (
                <a
                  href={event.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700 transition hover:bg-blue-100"
                >
                  <Video className="h-3.5 w-3.5" /> Join Call
                </a>
              )}
              {event.googleAttendeeStatus === 'invited' && (
                <p className="mt-2 text-xs text-gray-400">Google Calendar invite sent to your email.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    <div>
      <h2 className="mb-4 text-lg" style={{ fontFamily: "'Playfair Display', serif" }}>
        Recent Updates
      </h2>
      <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white shadow-sm">
        {myMatters
          .flatMap((matter) =>
            matter.clientVisibleNotes.map((note, index) => ({
              key: `${matter.id}-${index}`,
              matter: matter.title,
              ref: matter.referenceCode,
              note,
            }))
          )
          .slice(0, 5)
          .map((item) => (
            <div key={item.key} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gray-900" />
              <div>
                <p className="text-sm text-gray-700">{item.note}</p>
                <p className="text-xs text-gray-400">
                  {item.matter} · {item.ref}
                </p>
              </div>
            </div>
          ))}
      </div>
    </div>
  </div>
);

interface DashboardCasesSectionProps {
  filteredCases: Matter[];
  searchQuery: string;
  caseFilter: string;
  onSearchQueryChange: (value: string) => void;
  onCaseFilterChange: (value: string) => void;
  onOpenNewRequest: () => void;
  onSelectMatter: (matter: Matter) => void;
}

export const DashboardCasesSection = ({
  filteredCases,
  searchQuery,
  caseFilter,
  onSearchQueryChange,
  onCaseFilterChange,
  onOpenNewRequest,
  onSelectMatter,
}: DashboardCasesSectionProps) => (
  <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
        My Cases
      </h1>
      <button
        type="button"
        onClick={onOpenNewRequest}
        className="flex items-center gap-2 self-start rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
      >
        <Plus className="h-4 w-4" /> New Request
      </button>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search by title or reference..."
          className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {['all', 'in-progress', 'immediate', 'awaiting', 'completed'].map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => onCaseFilterChange(filter)}
            className={`rounded-lg border px-3 py-2 text-xs transition ${
              caseFilter === filter
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {filter === 'all'
              ? 'All'
              : filter === 'in-progress'
                ? 'In Progress'
                : filter === 'immediate'
                  ? 'Immediate'
                  : filter === 'awaiting'
                    ? 'Awaiting Action'
                    : 'Completed'}
          </button>
        ))}
      </div>
    </div>

    <div className="space-y-3">
      {filteredCases.length === 0 && (
        <div className="py-12 text-center text-gray-400">No cases found</div>
      )}
      {filteredCases.map((matter) => (
        <div
          key={matter.id}
          onClick={() => onSelectMatter(matter)}
          className="max-w-full cursor-pointer overflow-hidden rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 break-words text-sm">{matter.title}</h3>
                <span className="break-all font-mono text-[11px] text-gray-400">{matter.referenceCode}</span>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={matter.operationalStatus} />
                <StatusBadge status={matter.priority} />
                <UrgencyDot urgency={matter.urgency} />
              </div>
              <div className="max-w-full overflow-x-auto pb-1 sm:max-w-sm">
                <div className="min-w-[18rem] sm:min-w-0">
                  <LifecycleStepper stages={matter.stages} compact />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 text-xs text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:flex-shrink-0">
              <div className="text-left sm:text-right">
                <p>
                  {matter.selectedServices.length} service
                  {matter.selectedServices.length !== 1 ? 's' : ''}
                </p>
                <p className="text-gray-400">Started {formatDate(matter.createdAt)}</p>
              </div>
              {matter.totalFee > 0 && (
                <div className="text-left sm:text-right">
                  <p>{formatCurrency(matter.totalFee, matter.currencyCode || 'USD')}</p>
                  {matter.dueAmount > 0 && (
                    <p className="text-amber-600">Due: {formatCurrency(matter.dueAmount, matter.currencyCode || 'USD')}</p>
                  )}
                </div>
              )}
              <ChevronRight className="hidden h-4 w-4 text-gray-300 lg:block" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

interface DashboardDocumentsSectionProps {
  myDocs: PlatformDocument[];
  myMatters: Matter[];
  formatSize: (bytes: number) => string;
  isUploadingDocuments: boolean;
  onDownloadDocument: (documentId: string) => void;
  onPreviewDocument: (documentId: string) => void;
  onUploadDocuments: (files: File[]) => void;
}

const SAFE_DOCUMENT_PREVIEW_TYPES = new Set(['CSV', 'GIF', 'JPG', 'JPEG', 'PDF', 'PNG', 'TXT', 'WEBP']);

const documentScanLabel = (status?: string) => {
  switch (status) {
    case 'clean':
      return 'Scan clean';
    case 'infected':
    case 'blocked':
    case 'quarantined':
      return 'Blocked';
    case 'scan_failed':
      return 'Scan failed';
    case 'scan_skipped_manual_mode':
      return 'Not virus scanned';
    case 'pending_scan':
      return 'Scan pending';
    default:
      return 'Unscanned';
  }
};

const canPreviewDocument = (document: PlatformDocument) =>
  SAFE_DOCUMENT_PREVIEW_TYPES.has(document.type.toUpperCase()) && document.virusStatus === 'clean';

const canDownloadDocument = (document: PlatformDocument) =>
  !['blocked', 'infected', 'quarantined'].includes(document.virusStatus || '');

export const DashboardDocumentsSection = ({
  myDocs,
  myMatters,
  formatSize,
  isUploadingDocuments,
  onDownloadDocument,
  onPreviewDocument,
  onUploadDocuments,
}: DashboardDocumentsSectionProps) => {
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null);
  const groupedDocuments = myDocs.reduce<Record<string, PlatformDocument[]>>(
    (accumulator, document) => {
      const key = document.matterId || 'general';
      if (!accumulator[key]) {
        accumulator[key] = [];
      }
      accumulator[key].push(document);
      return accumulator;
    },
    {}
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
          Documents
        </h1>
        <input
          accept=".csv,.doc,.docx,.gif,.jpg,.jpeg,.pdf,.png,.txt,.webp,.xls,.xlsx,.zip"
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            if (files.length > 0) {
              onUploadDocuments(files);
            }
            event.currentTarget.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          disabled={isUploadingDocuments}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
        >
          <Upload className="h-4 w-4" /> {isUploadingDocuments ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {myDocs.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-500">
          Documents shared with you or uploaded by you will appear here after they are stored securely.
        </div>
      )}

      {Object.entries(groupedDocuments).map(([matterId, docs]) => {
        const matter = myMatters.find((entry) => entry.id === matterId);

        return (
          <div key={matterId} className="space-y-3">
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-gray-400" />
              <h3 className="text-sm">{matter?.title || 'General'}</h3>
              <span className="text-xs text-gray-400">{matter?.referenceCode}</span>
              <span className="ml-auto text-xs text-gray-400">
                {docs.length} file{docs.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white shadow-sm">
              {docs.map((document) => (
                <div key={document.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <FileText className="h-4 w-4 text-gray-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{document.name}</p>
                    <p className="text-xs text-gray-400">
                      {document.type} · {formatSize(document.size)} · {formatDate(document.uploadedAt)} · by{' '}
                      {document.uploadedBy} · {documentScanLabel(document.virusStatus)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(() => {
                      const canPreview = canPreviewDocument(document);

                      return (
                        <button
                          type="button"
                          disabled={!canPreview}
                          onClick={() => onPreviewDocument(document.id)}
                          title={canPreview ? 'Preview document' : 'Preview unavailable until this safe file type has a clean scan'}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      disabled={!canDownloadDocument(document)}
                      onClick={() => onDownloadDocument(document.id)}
                      title={canDownloadDocument(document) ? 'Download document' : 'Download blocked by malware scan policy'}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface DashboardBillingSectionProps {
  myInvoices: Invoice[];
  myPayments: Payment[];
  onDownloadInvoice: (invoiceId: string) => void;
  onPayInvoice: (invoiceId: string) => void;
  onViewInvoice: (invoiceId: string) => void;
}

export const DashboardBillingSection = ({
  myInvoices,
  myPayments,
  onDownloadInvoice,
  onPayInvoice,
  onViewInvoice,
}: DashboardBillingSectionProps) => {
  const currencyCode = myInvoices[0]?.currencyCode || 'USD';
  const paid = myInvoices
    .filter((invoice) => invoice.status === 'paid')
    .reduce((sum, invoice) => sum + invoice.totalAmount, 0);
  const pending = myInvoices
    .filter((invoice) => ['pending', 'sent'].includes(invoice.status))
    .reduce((sum, invoice) => sum + invoice.totalAmount, 0);
  const overdue = myInvoices
    .filter((invoice) => invoice.status === 'overdue')
    .reduce((sum, invoice) => sum + invoice.totalAmount, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
        Billing & Invoices
      </h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Paid', value: formatCurrency(paid, currencyCode), color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Pending', value: formatCurrency(pending, currencyCode), color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Overdue', value: formatCurrency(overdue, currencyCode), color: 'text-red-600', bg: 'bg-red-50' },
        ].map((card) => (
          <div key={card.label} className={`${card.bg} rounded-xl border border-gray-100 p-5`}>
            <p className="mb-1 text-xs text-gray-500">{card.label}</p>
            <p className={`text-2xl ${card.color}`} style={{ fontFamily: "'Playfair Display', serif" }}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Invoice', 'Matter', 'Amount', 'Issue Date', 'Due Date', 'Status', 'Actions'].map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-xs text-gray-500">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {myInvoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-sm">{invoice.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm">{invoice.matterTitle}</p>
                    <p className="text-xs text-gray-400">{invoice.matterRef}</p>
                  </td>
                  <td className="px-4 py-3 text-sm">{formatCurrency(invoice.totalAmount, invoice.currencyCode)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(invoice.issueDate)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(invoice.dueDate)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={invoice.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => onViewInvoice(invoice.id)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadInvoice(invoice.id)}
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {(invoice.status === 'pending' ||
                        invoice.status === 'sent' ||
                        invoice.status === 'overdue') && (
                        <button
                          type="button"
                          onClick={() => onPayInvoice(invoice.id)}
                          className="rounded bg-gray-900 px-2.5 py-1 text-[11px] text-white hover:bg-gray-800"
                        >
                          {invoice.paymentOptions?.onlineEnabled && invoice.amountDue > 0
                            ? 'Pay Online'
                            : 'Payment Info'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-gray-50/50 px-4 py-3">
          <h2 className="text-sm text-gray-700">Payment History</h2>
          <p className="text-xs text-gray-400">Payments are recorded by the Global LMG team after manual confirmation.</p>
        </div>
        {myPayments.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {myPayments.map((payment) => (
              <div key={payment.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-gray-900">{formatCurrency(payment.amount, currencyCode)}</p>
                  <p className="text-xs text-gray-400">
                    Invoice {payment.invoiceId} · {payment.method.replace('-', ' ')} · Ref {payment.reference}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <StatusBadge status={payment.status} />
                  <p className="mt-1 text-xs text-gray-400">{formatDate(payment.timestamp.split('T')[0])}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-gray-500">
            No payment records have been posted to your account yet.
          </div>
        )}
      </div>
    </div>
  );
};
