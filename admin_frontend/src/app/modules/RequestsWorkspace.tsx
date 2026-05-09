import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  FileText,
  HelpCircle,
  Loader2,
  Mail,
  Phone,
  Search,
  XCircle,
} from 'lucide-react';
import { StatusBadge, UrgencyDot } from '../components/dashboard/StatusBadge';
import { formatCurrency, formatDate, formatDateTime } from '../data/formatters';
import type {
  AdminRequestDecisionResponse,
  AdminRequestRecord,
  RequestsWorkspaceResponse,
} from '../lib/api/contracts';
import { EmptyState } from './EmptyState';

type RequestDecisionAction = 'approve' | 'convert' | 'decline' | 'request-info';

type RequestsWorkspaceProps = {
  metrics?: RequestsWorkspaceResponse['metrics'];
  onApprove?: (requestId: string, note?: string) => Promise<AdminRequestDecisionResponse>;
  onConvert?: (requestId: string, note?: string) => Promise<AdminRequestDecisionResponse>;
  onDecline?: (requestId: string, note?: string) => Promise<AdminRequestDecisionResponse>;
  onOpenClient?: (clientId: string) => void;
  onOpenMatter?: (matterId: string) => void;
  onRequestInfo?: (requestId: string, note?: string) => Promise<AdminRequestDecisionResponse>;
  requests?: AdminRequestRecord[];
};

const ACTION_COPY: Record<
  RequestDecisionAction,
  {
    confirmLabel: string;
    description: string;
    label: string;
    title: string;
  }
> = {
  approve: {
    confirmLabel: 'Approve Request',
    description:
      'Move this request into verification and notify the client that the Global LMG operations team has reviewed it.',
    label: 'Approve',
    title: 'Approve request',
  },
  convert: {
    confirmLabel: 'Convert Request',
    description:
      'Mark this request as converted and link it to its matter. If this older request has no matter yet, one will be created.',
    label: 'Convert',
    title: 'Convert request',
  },
  decline: {
    confirmLabel: 'Decline Request',
    description:
      'Close this request in the intake queue and notify the client. Existing linked records are preserved.',
    label: 'Decline',
    title: 'Decline request',
  },
  'request-info': {
    confirmLabel: 'Send Request',
    description:
      'Ask the client for more information. Add a clear note so they know what is needed next.',
    label: 'Request Info',
    title: 'Request more information',
  },
};

const matchesSearch = (request: AdminRequestRecord, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    request.requestNumber,
    request.title,
    request.clientName,
    request.clientEmail,
    request.ownerName,
    request.issueSummary,
    request.selectedServices.join(' '),
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalized);
};

export const RequestsWorkspace: React.FC<RequestsWorkspaceProps> = ({
  metrics,
  onApprove,
  onConvert,
  onDecline,
  onOpenClient,
  onOpenMatter,
  onRequestInfo,
  requests = [],
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState<'all' | 'converted' | 'open' | 'scheduled' | 'urgent'>('all');
  const [consultationFilter, setConsultationFilter] = useState<'all' | 'in-person' | 'phone' | 'video'>('all');
  const [pendingAction, setPendingAction] = useState<{
    action: RequestDecisionAction;
    request: AdminRequestRecord;
  } | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      if (!matchesSearch(request, searchQuery)) {
        return false;
      }

      if (queueFilter === 'urgent' && !['within-2hrs', 'within-6hrs'].includes(request.urgencyCode)) {
        return false;
      }

      if (queueFilter === 'scheduled' && !request.preferredStartAt) {
        return false;
      }

      if (queueFilter === 'converted' && !request.matterId) {
        return false;
      }

      if (queueFilter === 'open' && ['converted', 'lost-closed'].includes(request.statusCode)) {
        return false;
      }

      if (consultationFilter !== 'all' && request.consultationMode !== consultationFilter) {
        return false;
      }

      return true;
    });
  }, [consultationFilter, queueFilter, requests, searchQuery]);

  const serviceDemand = useMemo(() => {
    const counts = new Map<string, number>();

    requests.forEach((request) => {
      request.selectedServices.forEach((serviceCode) => {
        counts.set(serviceCode, (counts.get(serviceCode) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
  }, [requests]);

  const statusMix = useMemo(() => {
    const counts = new Map<string, number>();

    requests.forEach((request) => {
      counts.set(request.statusCode, (counts.get(request.statusCode) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
  }, [requests]);

  const getActionHandler = (action: RequestDecisionAction) => {
    if (action === 'approve') {
      return onApprove;
    }

    if (action === 'convert') {
      return onConvert;
    }

    if (action === 'decline') {
      return onDecline;
    }

    return onRequestInfo;
  };

  const openDecision = (action: RequestDecisionAction, request: AdminRequestRecord) => {
    setActionMessage(null);
    setActionError(null);
    setActionNote('');
    setPendingAction({ action, request });
  };

  const confirmDecision = async () => {
    if (!pendingAction) {
      return;
    }

    const handler = getActionHandler(pendingAction.action);
    if (!handler) {
      setActionError('This action is unavailable for this request.');
      return;
    }

    const note = actionNote.trim();
    if (pendingAction.action === 'request-info' && note.length === 0) {
      setActionError('Add a note before requesting more information.');
      return;
    }

    const busyKey = `${pendingAction.action}:${pendingAction.request.id}`;
    setBusyAction(busyKey);
    setActionError(null);

    try {
      const response = await handler(pendingAction.request.id, note || undefined);
      setActionMessage(response.message);
      setPendingAction(null);
      setActionNote('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Request action failed.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2
            className="text-2xl font-medium text-[#2C2B29]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Requests Intake
          </h2>
          <p className="text-sm text-[#8C8981] mt-1">
            Live intake queue from shared request records, consultation preferences, and conversion state.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'All Requests' },
            { id: 'open', label: 'Open Queue' },
            { id: 'urgent', label: 'Urgent' },
            { id: 'scheduled', label: 'Scheduled' },
            { id: 'converted', label: 'Converted' },
          ].map((filter) => (
            <button
              className={`px-3 py-1.5 rounded-lg border text-sm transition ${
                queueFilter === filter.id
                  ? 'bg-[#2C2B29] text-white border-[#2C2B29]'
                  : 'bg-white text-[#5A7C96] border-[#E6E4DD] hover:text-[#2C2B29] hover:bg-[#F4F1EA]'
              }`}
              key={filter.id}
              onClick={() => setQueueFilter(filter.id as typeof queueFilter)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Open Requests"
          tone="blue"
          value={metrics?.openRequests || requests.length}
        />
        <MetricCard
          label="Urgent Intake"
          tone="rose"
          value={metrics?.urgentRequests || 0}
        />
        <MetricCard
          label="Consultations Scheduled"
          tone="amber"
          value={metrics?.scheduledConsultations || 0}
        />
        <MetricCard
          label="Converted This Month"
          tone="emerald"
          value={metrics?.convertedThisMonth || 0}
        />
      </div>

      {actionMessage || actionError ? (
        <div
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
            actionError
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionError ? (
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span>{actionError || actionMessage}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[300px,minmax(0,1fr)] gap-6">
        <div className="space-y-6">
          <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm p-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8A69F]" />
              <input
                className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] pl-10 pr-4 py-2.5 text-sm outline-none focus:border-[#C19A5B]"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search requests, clients, services..."
                type="text"
                value={searchQuery}
              />
            </div>

            <div className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F] mb-3">
                Consultation Mode
              </p>
              <div className="flex flex-wrap gap-2">
                {(['all', 'video', 'phone', 'in-person'] as const).map((mode) => (
                  <button
                    className={`px-3 py-1.5 rounded-full border text-xs transition ${
                      consultationFilter === mode
                        ? 'bg-[#FDF8EF] text-[#997A48] border-[#EAD2A8]'
                        : 'bg-white text-[#8C8981] border-[#E6E4DD] hover:text-[#2C2B29]'
                    }`}
                    key={mode}
                    onClick={() => setConsultationFilter(mode)}
                    type="button"
                  >
                    {mode === 'all' ? 'Any Mode' : mode}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F] mb-4">
              Status Mix
            </p>
            <div className="space-y-3">
              {statusMix.map((entry) => (
                <div key={entry.code}>
                  <div className="flex items-center justify-between text-xs text-[#8C8981] mb-1">
                    <span>{entry.code.replace(/[-_]/g, ' ')}</span>
                    <span>{entry.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F4F1EA] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#5A7C96]"
                      style={{
                        width: `${Math.min(
                          100,
                          (entry.count /
                            Math.max(...statusMix.map((item) => item.count), 1)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F] mb-4">
              Service Demand
            </p>
            <div className="space-y-3">
              {serviceDemand.length ? (
                serviceDemand.map((service) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2"
                    key={service.code}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#2C2B29] truncate">{service.code}</p>
                    </div>
                    <span className="text-xs text-[#8C8981]">{service.count}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#8C8981]">No service selections yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {filteredRequests.length === 0 ? (
            <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm p-10">
              <EmptyState
                action={{ label: 'Clear Filters', onClick: () => {
                  setConsultationFilter('all');
                  setQueueFilter('all');
                  setSearchQuery('');
                } }}
                description="No requests match the current queue or consultation filters."
                icon={Search}
                title="No Requests Found"
              />
            </div>
          ) : (
            filteredRequests.map((request) => (
              <div
                className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm p-5 hover:border-[#D8C7A4] transition"
                key={request.id}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F]">
                        {request.requestNumber}
                      </span>
                      <StatusBadge status={request.statusCode} />
                      <UrgencyDot urgency={request.urgencyCode} />
                    </div>
                    <h3
                      className="text-xl text-[#2C2B29]"
                      style={{ fontFamily: "'Playfair Display', serif" }}
                    >
                      {request.title}
                    </h3>
                    <p className="text-sm text-[#5A7C96] mt-2 max-w-3xl">{request.issueSummary}</p>
                  </div>

                  <div className="flex flex-col items-start lg:items-end gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="px-3 py-2 rounded-lg border border-[#E6E4DD] bg-white text-sm text-[#2C2B29] hover:bg-[#F4F1EA] transition"
                        onClick={() => onOpenClient?.(request.clientId)}
                        type="button"
                      >
                        Open Client
                      </button>
                      <button
                        className="px-3 py-2 rounded-lg bg-[#2C2B29] text-white text-sm hover:bg-[#4A4946] transition disabled:opacity-60"
                        disabled={!request.matterId}
                        onClick={() => request.matterId && onOpenMatter?.(request.matterId)}
                        type="button"
                      >
                        {request.matterId ? 'Open Matter' : 'Awaiting Matter'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <DecisionButton
                        action="approve"
                        busyAction={busyAction}
                        disabled={request.statusCode === 'awaiting-verification' || ['converted', 'lost-closed'].includes(request.statusCode)}
                        label={request.statusCode === 'awaiting-verification' ? 'Approved' : 'Approve'}
                        onClick={() => openDecision('approve', request)}
                        requestId={request.id}
                      />
                      <DecisionButton
                        action="convert"
                        busyAction={busyAction}
                        disabled={['converted', 'lost-closed'].includes(request.statusCode)}
                        label={request.statusCode === 'converted' ? 'Converted' : 'Convert'}
                        onClick={() => openDecision('convert', request)}
                        requestId={request.id}
                      />
                      <DecisionButton
                        action="request-info"
                        busyAction={busyAction}
                        disabled={['converted', 'lost-closed'].includes(request.statusCode)}
                        label="Request Info"
                        onClick={() => openDecision('request-info', request)}
                        requestId={request.id}
                      />
                      <DecisionButton
                        action="decline"
                        busyAction={busyAction}
                        disabled={['converted', 'lost-closed'].includes(request.statusCode)}
                        label={request.statusCode === 'lost-closed' ? 'Declined' : 'Decline'}
                        onClick={() => openDecision('decline', request)}
                        requestId={request.id}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
                  <InfoTile
                    icon={Mail}
                    label="Client"
                    primary={request.clientName}
                    secondary={request.clientEmail}
                  />
                  <InfoTile
                    icon={Phone}
                    label="Contact"
                    primary={request.clientPhone}
                    secondary={`Owner: ${request.ownerName}`}
                  />
                  <InfoTile
                    icon={CalendarClock}
                    label="Consultation"
                    primary={
                      request.preferredStartAt ? formatDateTime(request.preferredStartAt) : 'Not scheduled yet'
                    }
                    secondary={request.consultationMode}
                  />
                  <InfoTile
                    icon={Briefcase}
                    label="Commercials"
                    primary={formatCurrency(request.quoteTotalAmount)}
                    secondary={request.matterNumber ? `Matter ${request.matterNumber}` : 'Lead stage'}
                  />
                </div>

                <div className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr),220px] gap-4">
                  <div className="rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText className="w-4 h-4 text-[#8C8981]" />
                      <p className="text-sm font-medium text-[#2C2B29]">Requested Services</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {request.selectedServices.length ? (
                        request.selectedServices.map((serviceCode) => (
                          <span
                            className="inline-flex items-center rounded-full border border-[#E6E4DD] bg-white px-3 py-1 text-xs text-[#5A7C96]"
                            key={serviceCode}
                          >
                            {serviceCode}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-[#8C8981]">No service selection captured.</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#E6E4DD] bg-[#FDF8EF] p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F] mb-2">
                      Timeline
                    </p>
                    <p className="text-sm font-medium text-[#2C2B29]">{formatDate(request.createdAt)}</p>
                    <p className="text-xs text-[#8C8981] mt-1">{request.expertiseArea}</p>
                    {request.preferredEndAt ? (
                      <p className="text-xs text-[#997A48] mt-3">
                        Window closes {formatDateTime(request.preferredEndAt)}
                      </p>
                    ) : null}
                    {request.urgencyCode === 'within-2hrs' ? (
                      <div className="mt-3 flex items-center gap-2 text-xs text-[#d4183d]">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Immediate handling needed
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {pendingAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-6">
          <div className="w-full max-w-lg rounded-xl border border-[#E6E4DD] bg-white shadow-xl">
            <div className="border-b border-[#E6E4DD] px-5 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F]">
                {pendingAction.request.requestNumber}
              </p>
              <h3
                className="mt-1 text-xl text-[#2C2B29]"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {ACTION_COPY[pendingAction.action].title}
              </h3>
            </div>
            <div className="space-y-4 px-5 py-4">
              <p className="text-sm text-[#5A7C96]">
                {ACTION_COPY[pendingAction.action].description}
              </p>
              <div className="rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2">
                <p className="text-sm font-medium text-[#2C2B29]">{pendingAction.request.title}</p>
                <p className="text-xs text-[#8C8981] mt-1">{pendingAction.request.clientName}</p>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-[#5A7C96]">
                  Note {pendingAction.action === 'request-info' ? '(required)' : '(optional)'}
                </span>
                <textarea
                  className="mt-2 min-h-28 w-full rounded-lg border border-[#E6E4DD] bg-white px-3 py-2 text-sm text-[#2C2B29] outline-none focus:border-[#C19A5B]"
                  maxLength={4000}
                  onChange={(event) => setActionNote(event.target.value)}
                  placeholder={
                    pendingAction.action === 'request-info'
                      ? 'Tell the client exactly what information is needed.'
                      : 'Add an internal/client-visible note for this decision.'
                  }
                  value={actionNote}
                />
              </label>
              {actionError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#E6E4DD] px-5 py-4">
              <button
                className="rounded-lg border border-[#E6E4DD] bg-white px-4 py-2 text-sm text-[#2C2B29] hover:bg-[#F4F1EA] transition"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  setPendingAction(null);
                  setActionNote('');
                  setActionError(null);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-[#2C2B29] px-4 py-2 text-sm text-white hover:bg-[#4A4946] transition disabled:opacity-60"
                disabled={
                  Boolean(busyAction) ||
                  (pendingAction.action === 'request-info' && actionNote.trim().length === 0)
                }
                onClick={() => void confirmDecision()}
                type="button"
              >
                {busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {ACTION_COPY[pendingAction.action].confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const DecisionButton = ({
  action,
  busyAction,
  disabled,
  label,
  onClick,
  requestId,
}: {
  action: RequestDecisionAction;
  busyAction: string | null;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  requestId: string;
}) => {
  const isBusy = busyAction === `${action}:${requestId}`;
  const Icon =
    action === 'approve'
      ? CheckCircle2
      : action === 'request-info'
        ? HelpCircle
        : action === 'decline'
          ? XCircle
          : Briefcase;
  const toneClass =
    action === 'decline'
      ? 'border-red-200 text-red-700 hover:bg-red-50'
      : action === 'convert'
        ? 'border-[#2C2B29] bg-[#2C2B29] text-white hover:bg-[#4A4946]'
        : 'border-[#E6E4DD] bg-white text-[#5A7C96] hover:bg-[#F4F1EA] hover:text-[#2C2B29]';

  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
      disabled={disabled || Boolean(busyAction)}
      onClick={onClick}
      type="button"
    >
      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
};

const MetricCard = ({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'amber' | 'blue' | 'emerald' | 'rose';
  value: number;
}) => {
  const toneClasses: Record<typeof tone, string> = {
    amber: 'bg-[#FDF8EF] border-[#EAD2A8]',
    blue: 'bg-[#EFF3F6] border-[#D6E4EE]',
    emerald: 'bg-[#EEF9F1] border-[#CFE8D5]',
    rose: 'bg-[#FDE8EC] border-[#F5C2C7]',
  };

  return (
    <div className={`rounded-xl border p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#8C8981]">{label}</p>
      <p
        className="text-3xl mt-3 text-[#2C2B29]"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {value}
      </p>
    </div>
  );
};

const InfoTile = ({
  icon: Icon,
  label,
  primary,
  secondary,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary: string;
}) => (
  <div className="rounded-xl border border-[#E6E4DD] bg-white p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-4 h-4 text-[#8C8981]" />
      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F]">{label}</p>
    </div>
    <p className="text-sm font-medium text-[#2C2B29]">{primary}</p>
    <p className="text-xs text-[#8C8981] mt-1">{secondary}</p>
  </div>
);
