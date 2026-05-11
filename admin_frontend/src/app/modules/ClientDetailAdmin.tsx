import React, { useState } from 'react';
import { 
  ArrowLeft, Mail, Phone, MapPin, Calendar, Clock, 
  FileText, Folder, CreditCard, Shield, Activity as ActivityIcon,
  CheckCircle, AlertCircle, Edit2, User, Globe, MessageSquare, Briefcase, Plus, ChevronRight, Video, History, Download
} from 'lucide-react';
import { formatCurrency, formatDate, formatDateTime } from '../data/formatters';
import type {
  AuditEntry,
  Invoice,
  Matter,
  MessageThread,
  Payment,
  PlatformDocument,
  PlatformEvent,
  PlatformUser,
  SystemNotification,
} from '../data/adminTypes';
import { StatusBadge, UrgencyDot } from '../components/dashboard/StatusBadge';
import {
  DOCUMENT_ROUTE_PERMISSIONS,
  EVENT_ROUTE_PERMISSIONS,
  MATTER_ROUTE_PERMISSIONS,
  MESSAGE_ROUTE_PERMISSIONS,
} from '../config/navigation';
import { EmptyState } from './EmptyState';
import type { AdminRequestRecord, ClientWorkspaceResponse } from '../lib/api/contracts';

type ClientDetailTab =
  | 'overview'
  | 'requests'
  | 'matters'
  | 'billing'
  | 'documents'
  | 'messages'
  | 'meetings'
  | 'activity';

interface ClientDetailAdminProps {
  client: PlatformUser;
  matters: Matter[];
  invoices: Invoice[];
  notifications?: SystemNotification[];
  payments?: Payment[];
  permissionCodes?: string[];
  requests?: AdminRequestRecord[];
  summary?: ClientWorkspaceResponse['summary'];
  documents: PlatformDocument[];
  events: PlatformEvent[];
  threads?: MessageThread[];
  auditEntries?: AuditEntry[];
  onBack: () => void;
  onCreateMatter?: () => void;
  onViewMatter: (matter: Matter) => void;
}

export const ClientDetailAdmin: React.FC<ClientDetailAdminProps> = ({
  client,
  matters,
  invoices,
  notifications = [],
  payments = [],
  permissionCodes = [],
  requests = [],
  summary,
  documents,
  events,
  threads = [],
  auditEntries = [],
  onBack,
  onCreateMatter,
  onViewMatter
}) => {
  const [activeTab, setActiveTab] = useState<ClientDetailTab>('overview');
  const hasPermission = (permission: string) => permissionCodes.includes(permission);
  const hasAnyPermission = (permissions: string[]) => permissions.some((permission) => permissionCodes.includes(permission));
  const canViewRequests = hasPermission('matter.view');
  const canViewMatters = hasAnyPermission(MATTER_ROUTE_PERMISSIONS);
  const canViewBilling = hasAnyPermission(['invoice.view', 'payment.view', 'refund.view']);
  const canViewDocuments = hasAnyPermission(DOCUMENT_ROUTE_PERMISSIONS);
  const canViewMessages = hasAnyPermission(MESSAGE_ROUTE_PERMISSIONS);
  const canViewMeetings = hasAnyPermission(EVENT_ROUTE_PERMISSIONS);
  const canViewActivity = hasAnyPermission(['notification.view', 'audit.view']);
  const totalBilled = summary?.totalBilled ?? invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalPaid =
    summary?.totalPaid ??
    payments
      .filter((payment) => payment.status === 'success')
      .reduce((sum, payment) => sum + payment.amount, 0);
  const totalDue = summary?.outstandingBalance ?? Math.max(totalBilled - totalPaid, 0);
  
  const clientThreads = threads.filter(t => t.clientId === client.id);
  const upcomingMeetings = events
    .filter((event) => event.status === 'upcoming')
    .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`));
  const clientAudit = auditEntries.slice(0, 5);
  const successfulPayments = payments.filter((payment) => payment.status === 'success');
  const visibleTabs: Array<{ id: ClientDetailTab; label: string }> = [
    { id: 'overview', label: 'Client 360 Overview' },
    canViewRequests ? { id: 'requests', label: `Requests (${requests.length})` } : null,
    canViewMatters ? { id: 'matters', label: `Matters (${matters.length})` } : null,
    canViewMessages ? { id: 'messages', label: `Messages (${clientThreads.length})` } : null,
    canViewDocuments ? { id: 'documents', label: `Vault (${documents.length})` } : null,
    canViewBilling ? { id: 'billing', label: `Billing & Ledger (${invoices.length})` } : null,
    canViewMeetings ? { id: 'meetings', label: `Meetings (${events.length})` } : null,
    canViewActivity ? { id: 'activity', label: `Activity (${auditEntries.length + notifications.length})` } : null,
  ].filter((tab): tab is { id: ClientDetailTab; label: string } => Boolean(tab));

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Directory
      </button>

      {/* Client Header (Original Design Restored) */}
      <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-2xl font-medium">
            {client.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>{client.name}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-500 mt-1">
              <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5"/> {client.email}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5"/> {client.phone}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="cursor-not-allowed rounded-lg border border-dashed border-gray-200 px-4 py-2 text-sm text-gray-400"
            disabled
            title="Profile editing is managed from account settings."
            type="button"
          >
            Edit Profile
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm transition ${
              onCreateMatter
                ? 'border border-gray-200 bg-gray-900 text-white hover:bg-gray-800'
                : 'cursor-not-allowed border border-dashed border-gray-200 bg-gray-50 text-gray-400'
            }`}
            disabled={!onCreateMatter}
            onClick={onCreateMatter}
            title={onCreateMatter ? 'Create a new matter for this client.' : 'New matter creation is unavailable in this workspace.'}
            type="button"
          >
            New Matter
          </button>
        </div>
      </div>

      {/* Tabs (Original Design Restored + new tabs) */}
      <div className="flex gap-6 border-b border-gray-200 overflow-x-auto no-scrollbar">
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-3 text-sm font-medium transition border-b-2 whitespace-nowrap ${activeTab === tab.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="py-2">
        {activeTab === 'overview' && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              {/* Original Active Matters */}
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Active Matters</h3>
                <div className="space-y-3">
                  {matters.filter(m => m.operationalStatus !== 'completed').map(m => (
                    <div key={m.id} onClick={() => onViewMatter(m)} className="p-4 border border-gray-100 rounded-lg hover:bg-gray-50 cursor-pointer transition flex justify-between items-center">
                      <div>
                        <p className="font-medium text-gray-900">{m.title}</p>
                        <p className="text-xs text-gray-500">{m.referenceCode} • Stage: {m.lifecycleStage.replace(/-/g, ' ')}</p>
                      </div>
                      <StatusBadge status={m.operationalStatus} size="sm" />
                    </div>
                  ))}
                  {matters.filter(m => m.operationalStatus !== 'completed').length === 0 && (
                    <div className="py-8">
                      <EmptyState 
                        icon={Briefcase} 
                        title="No active matters" 
                        description="This client currently has no active matters."
                      />
                    </div>
                  )}
                </div>
              </div>

              {canViewMessages || canViewDocuments ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Recent Messages */}
                {canViewMessages ? (
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                      <MessageSquare className="w-4 h-4 text-blue-500" /> Recent Messages
                    </h3>
                  </div>
                  <div className="p-4 flex-1">
                    <div className="space-y-4">
                      {clientThreads.slice(0, 3).map(thread => (
                        <div key={thread.id} className="flex gap-3 group cursor-pointer">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                            {thread.unreadCount > 0 ? <Mail className="w-4 h-4 text-red-500" /> : <MessageSquare className="w-4 h-4 text-gray-500" />}
                          </div>
                          <div>
                            <div className="flex justify-between items-start mb-0.5">
                              <p className={`text-sm ${thread.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{thread.matterTitle || 'General Support'}</p>
                              <span className="text-[10px] text-gray-500 whitespace-nowrap ml-2">{formatDate(thread.lastMessageAt)}</span>
                            </div>
                            <p className={`text-xs line-clamp-2 ${thread.unreadCount > 0 ? 'text-gray-900' : 'text-gray-500'}`}>
                              {thread.lastMessage}
                            </p>
                          </div>
                        </div>
                      ))}
                      {clientThreads.length === 0 && (
                        <div className="py-6">
                          <EmptyState 
                            icon={MessageSquare} 
                            title="No messages" 
                            description="There are no recent messages for this client."
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-3 border-t border-gray-100 bg-gray-50 text-center">
                    <button onClick={() => setActiveTab('messages')} className="text-xs font-medium text-blue-600 hover:text-blue-700">View all messages &rarr;</button>
                  </div>
                </div>
                ) : null}

                {/* Recent Documents */}
                {canViewDocuments ? (
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-amber-500" /> Recent Documents
                    </h3>
                  </div>
                  <div className="p-4 flex-1">
                    <div className="space-y-4">
                      {documents.slice(0, 3).map(doc => (
                        <div key={doc.id} className="flex gap-3 group cursor-pointer items-start">
                          <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                            <FileText className="w-4 h-4 text-gray-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-600">{doc.name}</p>
                            <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-1">
                              <span>{formatDate(doc.uploadedAt)}</span>
                              <span>•</span>
                              <span className="uppercase">{doc.name.split('.').pop() || 'DOC'}</span>
                            </div>
                          </div>
                          <button className="p-1 text-gray-400 hover:text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {documents.length === 0 && (
                        <div className="py-6">
                          <EmptyState 
                            icon={FileText} 
                            title="No documents" 
                            description="There are no documents stored for this client."
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-3 border-t border-gray-100 bg-gray-50 text-center">
                    <button onClick={() => setActiveTab('documents')} className="text-xs font-medium text-amber-600 hover:text-amber-700">Open Vault &rarr;</button>
                  </div>
                </div>
                ) : null}
              </div>
              ) : null}
            </div>

            {/* Right Column: Financial Snapshot, Meetings, Activity */}
            <div className="space-y-6">
              
              {/* Financial Snapshot */}
              {canViewBilling ? (
              <div className="bg-gray-900 text-white rounded-xl p-6 shadow-md">
                <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> Financial Snapshot
                </h3>
                
                <div className="mb-6">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Outstanding</p>
                  <p className="text-3xl font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {formatCurrency(totalDue)}
                  </p>
                  {totalDue > 0 && (
                    <button onClick={() => setActiveTab('billing')} className="mt-3 px-4 py-2 text-xs font-medium bg-white text-gray-900 rounded hover:bg-gray-100 transition-colors shadow-sm w-full">
                      Send Payment Reminder
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-gray-800 pt-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Billed</p>
                    <p className="font-medium text-gray-200">{formatCurrency(totalBilled)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Total Paid</p>
                    <p className="font-medium text-green-400">{formatCurrency(totalPaid)}</p>
                  </div>
                </div>
              </div>
              ) : null}

              {/* Upcoming Meetings */}
              {canViewMeetings ? (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4 text-sm">
                  <Calendar className="w-4 h-4 text-gray-500" /> Upcoming Meetings
                </h3>
                <div className="space-y-3">
                  {upcomingMeetings.length > 0 ? upcomingMeetings.slice(0, 2).map(meeting => (
                    <div key={meeting.id} className="p-3 border border-gray-100 rounded-lg bg-gray-50">
                      <div className="flex items-center gap-2 mb-2">
                        <UrgencyDot urgency="standard" />
                        <span className="text-sm font-medium text-gray-900">{meeting.title}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDateTime(`${meeting.date}T${meeting.time}`)}</span>
                        <span className="flex items-center gap-1"><Video className="w-3 h-3" /> {meeting.mode}</span>
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg text-center">No upcoming meetings</p>
                  )}
                  <button className="w-full py-2 border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors mt-2">
                    Schedule Meeting
                  </button>
                </div>
              </div>
              ) : null}

              {/* Activity Timeline */}
              {canViewActivity ? (
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4 text-sm">
                  <History className="w-4 h-4 text-gray-500" /> Recent Activity
                </h3>
                <div className="relative before:absolute before:inset-0 before:ml-[9px] before:w-px before:bg-gray-200 space-y-4">
                  {clientAudit.map((entry, idx) => (
                    <div key={idx} className="relative flex gap-4">
                      <div className="w-5 h-5 rounded-full bg-white border-2 border-gray-300 shrink-0 z-10" />
                      <div className="flex-1 min-w-0 pb-1">
                        <p className="text-sm text-gray-900 font-medium">{entry.action.replace(/_/g, ' ')}</p>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{entry.details}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{formatDate(entry.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setActiveTab('activity')} className="mt-4 w-full text-center text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors">
                  View Full Timeline
                </button>
              </div>
              ) : null}

            </div>
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-500" /> Requests
                </h3>
                <p className="text-xs text-gray-500 mt-1">Client intake and decision history from the request workspace.</p>
              </div>
              <span className="text-xs text-gray-500">{requests.length} records</span>
            </div>
            <div className="divide-y divide-gray-100">
              {requests.map((request) => (
                <div key={request.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">{request.title}</p>
                      <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                        {request.statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {request.requestNumber} • {request.expertiseArea} • {formatDate(request.createdAt)}
                    </p>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{request.issueSummary}</p>
                    {request.matterNumber ? (
                      <p className="text-xs text-emerald-700 mt-2">Converted to {request.matterNumber}</p>
                    ) : null}
                  </div>
                  <div className="text-left lg:text-right shrink-0">
                    <p className="text-sm font-medium text-gray-900">{formatCurrency(request.quoteTotalAmount)}</p>
                    <p className="text-xs text-gray-500 mt-1">{request.urgencyLabel}</p>
                    <p className="text-xs text-gray-500">{request.consultationMode}</p>
                  </div>
                </div>
              ))}
              {requests.length === 0 && (
                <div className="p-12">
                  <EmptyState icon={Shield} title="No requests" description="No intake requests are linked to this client yet." />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'matters' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-indigo-500" /> Matters
                </h3>
                <p className="text-xs text-gray-500 mt-1">All matters currently linked to this client account.</p>
              </div>
              <span className="text-xs text-gray-500">{matters.length} records</span>
            </div>
            <div className="grid xl:grid-cols-2 gap-4 p-5">
              {matters.map((matter) => (
                <button
                  key={matter.id}
                  onClick={() => onViewMatter(matter)}
                  className="text-left p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition flex flex-col gap-3"
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{matter.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{matter.referenceCode}</p>
                    </div>
                    <StatusBadge status={matter.operationalStatus} size="sm" />
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">{matter.issueSummary}</p>
                  <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                    <span>Stage: {matter.lifecycleStage.replace(/-/g, ' ')}</span>
                    <span>Updated: {formatDate(matter.lastUpdated)}</span>
                    <span>Counsel: {matter.assignedCounsel || 'Unassigned'}</span>
                    <span>Staff: {matter.assignedStaff || 'Unassigned'}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                    <span className="text-xs text-gray-500">Due {formatCurrency(matter.dueAmount)}</span>
                    <span className="text-xs font-medium text-gray-900 flex items-center gap-1">
                      Open Matter <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </button>
              ))}
              {matters.length === 0 && (
                <div className="xl:col-span-2 p-12">
                  <EmptyState icon={Briefcase} title="No matters" description="No matters are linked to this client yet." />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="space-y-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wide">Billed</p>
                <p className="text-2xl font-medium mt-2">{formatCurrency(totalBilled)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wide">Paid</p>
                <p className="text-2xl font-medium mt-2 text-emerald-700">{formatCurrency(totalPaid)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wide">Outstanding</p>
                <p className="text-2xl font-medium mt-2 text-amber-700">{formatCurrency(totalDue)}</p>
              </div>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-gray-500" /> Invoices and Payments
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">Invoice and manual payment records scoped to this client.</p>
                </div>
                <span className="text-xs text-gray-500">{successfulPayments.length} successful payments</span>
              </div>
              <div className="divide-y divide-gray-100">
                {invoices.map((invoice) => {
                  const invoicePayments = successfulPayments.filter((payment) => payment.invoiceId === invoice.id);
                  const paidAmount = invoicePayments.reduce((sum, payment) => sum + payment.amount, 0);
                  const balance = Math.max(invoice.totalAmount - paidAmount, 0);

                  return (
                    <div key={invoice.id} className="p-5">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-gray-900">{invoice.id}</p>
                            <StatusBadge status={invoice.status} size="sm" />
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{invoice.matterTitle || 'General billing'}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Issued {formatDate(invoice.issueDate)} • Due {formatDate(invoice.dueDate)}
                          </p>
                        </div>
                        <div className="text-left lg:text-right">
                          <p className="font-medium text-gray-900">{formatCurrency(invoice.totalAmount)}</p>
                          <p className="text-xs text-emerald-700 mt-1">Paid {formatCurrency(paidAmount)}</p>
                          <p className="text-xs text-amber-700">Balance {formatCurrency(balance)}</p>
                        </div>
                      </div>
                      {invoicePayments.length > 0 ? (
                        <div className="mt-4 rounded-lg bg-gray-50 border border-gray-100 divide-y divide-gray-100">
                          {invoicePayments.map((payment) => (
                            <div key={payment.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-gray-800">{payment.reference}</span>
                              <span className="text-gray-500">{payment.method} • {formatDateTime(payment.timestamp)}</span>
                              <span className="text-emerald-700 font-medium">{formatCurrency(payment.amount)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {invoices.length === 0 && (
                  <div className="p-12">
                    <EmptyState icon={CreditCard} title="No invoices" description="No invoices or payment records are linked to this client yet." />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-500" /> Document Vault
                </h3>
                <p className="text-xs text-gray-500 mt-1">Documents owned by this client account and linked matters.</p>
              </div>
              <span className="text-xs text-gray-500">{documents.length} records</span>
            </div>
            <div className="divide-y divide-gray-100">
              {documents.map((document) => (
                <div key={document.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{document.name}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {document.matterTitle || 'General'} • {document.type} • {formatDateTime(document.uploadedAt)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Uploaded by {document.uploadedBy}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                      {document.visibility}
                    </span>
                    <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                      {document.reviewState}
                    </span>
                  </div>
                </div>
              ))}
              {documents.length === 0 && (
                <div className="p-12">
                  <EmptyState icon={FileText} title="No documents" description="No documents are linked to this client yet." />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-500" /> Message Threads
                </h3>
                <p className="text-xs text-gray-500 mt-1">Conversation threads scoped to this client account.</p>
              </div>
              <span className="text-xs text-gray-500">{summary?.unreadThreadCount ?? clientThreads.filter((thread) => thread.unreadCount > 0).length} unread</span>
            </div>
            <div className="divide-y divide-gray-100">
              {clientThreads.map((thread) => (
                <div key={thread.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">{thread.matterTitle || 'General Support'}</p>
                      {thread.unreadCount > 0 ? (
                        <span className="px-2 py-1 rounded-full bg-red-50 text-red-700 text-[10px] font-bold uppercase tracking-wide">
                          {thread.unreadCount} unread
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {thread.status} • Assigned to {thread.assignedTo} • {thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : 'No messages yet'}
                    </p>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{thread.lastMessage || 'No message body recorded.'}</p>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">{thread.matterRef || 'General'}</span>
                </div>
              ))}
              {clientThreads.length === 0 && (
                <div className="p-12">
                  <EmptyState icon={MessageSquare} title="No threads" description="No message threads are linked to this client yet." />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'meetings' && (
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-500" /> Meetings and Events
                </h3>
                <p className="text-xs text-gray-500 mt-1">Calendar records linked to this client and their matters.</p>
              </div>
              <span className="text-xs text-gray-500">{events.length} records</span>
            </div>
            <div className="divide-y divide-gray-100">
              {events.map((event) => (
                <div key={event.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">{event.title}</p>
                      <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold uppercase tracking-wide">
                        {event.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {event.matterTitle || 'General'} • {formatDate(event.date)} {event.time} • {event.mode}
                    </p>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{event.notes || event.location || 'No event notes recorded.'}</p>
                  </div>
                  <div className="text-left lg:text-right text-xs text-gray-500 shrink-0">
                    <p>{event.calendarSyncStatus || 'local'} calendar mode</p>
                    <p>{event.reminderStatus || 'none'} reminders</p>
                    {event.meetLink ? <p className="text-blue-600 mt-1">Meeting link available</p> : null}
                  </div>
                </div>
              ))}
              {events.length === 0 && (
                <div className="p-12">
                  <EmptyState icon={Calendar} title="No meetings" description="No meetings or events are linked to this client yet." />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <ActivityIcon className="w-4 h-4 text-violet-500" /> Client Notifications
                </h3>
                <p className="text-xs text-gray-500 mt-1">Notification activity scoped to this client.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <div key={notification.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">{notification.title}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {notification.source} • {formatDateTime(notification.date)}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${notification.read ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700'}`}>
                        {notification.read ? 'read' : 'unread'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">{notification.body}</p>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <div className="p-12">
                    <EmptyState icon={ActivityIcon} title="No notifications" description="No notifications are linked to this client yet." />
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <History className="w-4 h-4 text-gray-500" /> Audit Timeline
                </h3>
                <p className="text-xs text-gray-500 mt-1">Matter-linked audit activity for this client.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {auditEntries.map((entry) => (
                  <div key={entry.id} className="p-5">
                    <p className="font-medium text-gray-900">{entry.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {entry.actor} • {entry.sourceModule} • {formatDateTime(entry.timestamp)}
                    </p>
                    <p className="text-sm text-gray-600 mt-2">{entry.details}</p>
                  </div>
                ))}
                {auditEntries.length === 0 && (
                  <div className="p-12">
                    <EmptyState icon={History} title="No audit events" description="No matter audit events are linked to this client yet." />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
