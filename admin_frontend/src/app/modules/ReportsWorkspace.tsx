import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Printer,
  Users,
  Zap,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { formatCurrency } from '../data/formatters';
import { adminApi } from '../lib/api/admin';
import type {
  ReportDrilldownItem,
  ReportDrilldownKind,
  ReportDrilldownResponse,
  ReportsWorkspaceResponse,
} from '../lib/api/contracts';
import { EmptyState } from './EmptyState';

type ReportsWorkspaceProps = {
  workspace: ReportsWorkspaceResponse;
};

const REPORT_DRILLDOWN_KINDS = new Set<ReportDrilldownKind>([
  'active-matters',
  'closed-matters',
  'converted-requests',
  'declined-requests',
  'failed-reminders',
  'open-requests',
  'outstanding-invoices',
  'overdue-invoices',
  'paid-invoices',
  'pending-documents',
  'pending-reminders',
  'recent-notifications',
  'stale-matters',
  'upcoming-events',
  'waiting-threads',
]);

export const ReportsWorkspace: React.FC<ReportsWorkspaceProps> = ({ workspace }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState<'Custom' | 'Q2' | 'Q3' | 'YTD'>('YTD');
  const [activeDrilldown, setActiveDrilldown] = useState<ReportDrilldownResponse | null>(null);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isLoadingDrilldown, setIsLoadingDrilldown] = useState(false);

  const maxRevenue = useMemo(
    () =>
      Math.max(
        ...workspace.revenueTrend.flatMap((point) => [point.currentRevenue, point.previousRevenue]),
        1
      ),
    [workspace.revenueTrend]
  );

  const loadDrilldown = async (kind: ReportDrilldownKind) => {
    setDrilldownError(null);
    setIsLoadingDrilldown(true);

    try {
      setActiveDrilldown(await adminApi.getReportDrilldown(kind));
    } catch (error) {
      setDrilldownError(error instanceof Error ? error.message : 'Unable to load report drilldown.');
    } finally {
      setIsLoadingDrilldown(false);
    }
  };

  useEffect(() => {
    const requestedKind = searchParams.get('drilldown');

    if (!requestedKind || !REPORT_DRILLDOWN_KINDS.has(requestedKind as ReportDrilldownKind)) {
      return;
    }

    if (activeDrilldown?.kind === requestedKind || isLoadingDrilldown) {
      return;
    }

    void loadDrilldown(requestedKind as ReportDrilldownKind);
  }, [activeDrilldown?.kind, isLoadingDrilldown, searchParams]);

  const selectDrilldown = (kind: ReportDrilldownKind) => {
    setSearchParams({ drilldown: kind });
    void loadDrilldown(kind);
  };

  const handleExportCsv = async (kind: ReportDrilldownKind) => {
    setExportError(null);
    setExportMessage(null);
    setIsExportingCsv(true);

    try {
      const result = await adminApi.downloadReportDrilldownCsv(kind);
      setExportMessage(`CSV downloaded: ${result.fileName}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Unable to export this drilldown.');
    } finally {
      setIsExportingCsv(false);
    }
  };

  const openRecord = (item: ReportDrilldownItem) => {
    switch (item.routeType) {
      case 'matter':
        if (item.routeId) {
          navigate(`/matters/${item.routeId}`);
        }
        return;
      case 'request':
        navigate('/requests');
        return;
      case 'invoice':
        navigate('/billing');
        return;
      case 'message':
        navigate('/messages');
        return;
      case 'document':
        navigate('/documents');
        return;
      case 'event':
        navigate('/meetings');
        return;
      case 'reminder':
      case 'notification':
        navigate('/notifications');
        return;
      default:
        return;
    }
  };

  const kpiCards: Array<{
    amount?: boolean;
    kind: ReportDrilldownKind;
    label: string;
    tone: 'amber' | 'blue' | 'emerald' | 'neutral' | 'rose' | 'violet';
    value: number;
  }> = [
    { kind: 'open-requests', label: 'Open Requests', tone: 'blue', value: workspace.kpis.openRequests },
    { kind: 'converted-requests', label: 'Converted Requests', tone: 'emerald', value: workspace.kpis.convertedRequests },
    { kind: 'declined-requests', label: 'Declined Requests', tone: 'rose', value: workspace.kpis.declinedRequests },
    { kind: 'active-matters', label: 'Active Matters', tone: 'blue', value: workspace.kpis.activeMatters },
    { kind: 'stale-matters', label: 'Stale Matters', tone: 'amber', value: workspace.kpis.staleMatters },
    { kind: 'closed-matters', label: 'Closed Matters', tone: 'neutral', value: workspace.kpis.closedMatters },
    { kind: 'overdue-invoices', label: 'Overdue Invoices', tone: 'rose', value: workspace.kpis.overdueInvoices },
    { amount: true, kind: 'outstanding-invoices', label: 'Outstanding Amount', tone: 'amber', value: workspace.kpis.outstandingInvoiceAmount },
    { amount: true, kind: 'paid-invoices', label: 'Paid Invoice Amount', tone: 'emerald', value: workspace.kpis.paidInvoiceAmount },
    { kind: 'waiting-threads', label: 'Waiting Threads', tone: 'violet', value: workspace.kpis.waitingThreads },
    { kind: 'pending-documents', label: 'Pending Documents', tone: 'amber', value: workspace.kpis.pendingDocumentReviews },
    { kind: 'upcoming-events', label: 'Upcoming Events', tone: 'blue', value: workspace.kpis.upcomingEvents },
    { kind: 'pending-reminders', label: 'Pending Reminders', tone: 'neutral', value: workspace.kpis.pendingReminders },
    { kind: 'failed-reminders', label: 'Failed Reminders', tone: 'rose', value: workspace.kpis.failedReminders },
    { kind: 'recent-notifications', label: 'Recent Client Activity', tone: 'violet', value: workspace.kpis.recentClientActivity },
  ];

  if (!workspace.revenueTrend.length && !workspace.stageMix.length) {
    return (
      <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm p-10">
        <EmptyState
          description="We need more billing, matter, and intake activity before performance reporting can render."
          icon={BarChart3}
          title="No Report Data Yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h2
            className="text-3xl font-medium text-[#2C2B29]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Platform Performance
          </h2>
          <p className="text-sm text-[#8C8981] mt-1">
            Strategic reporting across collections, intake conversion, matter throughput, and delivery pressure.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-white border border-[#E6E4DD] rounded-lg p-1 shadow-sm">
            {(['YTD', 'Q3', 'Q2', 'Custom'] as const).map((value) => (
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  range === value ? 'bg-[#F4F1EA] text-[#2C2B29]' : 'text-[#8C8981] hover:text-[#2C2B29]'
                }`}
                key={value}
                onClick={() => setRange(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
          <button
            className="px-4 py-2 bg-white border border-[#E6E4DD] rounded-lg shadow-sm text-sm font-medium text-[#2C2B29] hover:bg-[#F4F1EA] transition flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!activeDrilldown || isExportingCsv}
            onClick={() => activeDrilldown && void handleExportCsv(activeDrilldown.kind)}
            type="button"
          >
            {isExportingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export selected drilldown CSV
          </button>
          <button
            className="px-4 py-2 bg-[#2C2B29] text-white rounded-lg shadow-sm text-sm font-medium hover:bg-[#4A4946] transition flex items-center gap-2"
            onClick={() => window.print()}
            title="Uses your browser print dialog. Choose Save as PDF there if you need a PDF file."
            type="button"
          >
            <Printer className="w-4 h-4" /> Print report
          </button>
        </div>
      </div>

      {!activeDrilldown || exportError || exportMessage ? (
        <div className="rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 text-sm text-[#5A7C96]">
          {!activeDrilldown ? 'Select a KPI drilldown before exporting CSV. Print report uses the browser print dialog and can be saved as PDF from there.' : null}
          {exportError ? <span className="text-[#9E3D3D]">{exportError}</span> : null}
          {exportMessage ? <span className="text-[#337348]">{exportMessage}</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ReportMetricCard
          accent="gold"
          icon={CreditCard}
          label="Total Collections"
          trend="up"
          trendLabel={`${workspace.summary.totalRequests} total requests`}
          value={formatCurrency(workspace.summary.totalCollections)}
        />
        <ReportMetricCard
          accent="blue"
          icon={Users}
          label="Client Conversion"
          trend="up"
          trendLabel="lead to matter"
          value={`${workspace.summary.clientConversionRate}%`}
        />
        <ReportMetricCard
          accent="rose"
          icon={FileText}
          label="Refunds & Write-offs"
          trend="down"
          trendLabel="risk exposure"
          value={formatCurrency(workspace.summary.refundsWriteOffs)}
        />
        <ReportMetricCard
          accent="violet"
          icon={Zap}
          label="Avg Resolution Time"
          trend="neutral"
          trendLabel="closed matters"
          value={`${workspace.summary.averageResolutionDays} days`}
        />
      </div>

      <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-[#E6E4DD] flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="font-medium text-[#2C2B29]">KPI Drilldowns</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">
              Each card opens the same DB-backed records used for its count.
            </p>
          </div>
          {activeDrilldown ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-[#E6E4DD] bg-white px-3 py-2 text-sm text-[#2C2B29] hover:bg-[#F4F1EA] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isExportingCsv}
              onClick={() => void handleExportCsv(activeDrilldown.kind)}
              type="button"
            >
              {isExportingCsv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export selected drilldown CSV
            </button>
          ) : null}
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {kpiCards.map((card) => (
            <button
              className="text-left"
              key={card.kind}
              onClick={() => selectDrilldown(card.kind)}
              type="button"
            >
              <DrilldownKpiCard
                active={activeDrilldown?.kind === card.kind}
                label={card.label}
                tone={card.tone}
                value={card.amount ? formatCurrency(card.value) : String(card.value)}
              />
            </button>
          ))}
        </div>

        <div className="border-t border-[#E6E4DD] p-5">
          {isLoadingDrilldown ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#E6E4DD] bg-[#FCFBF8] p-8 text-sm text-[#8C8981]">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading drilldown
            </div>
          ) : drilldownError ? (
            <div className="rounded-xl border border-[#F5C2C7] bg-[#FDE8EC] p-4 text-sm text-[#d4183d]">
              {drilldownError}
            </div>
          ) : activeDrilldown ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium text-[#2C2B29]">
                    {activeDrilldown.label} · {activeDrilldown.total} record{activeDrilldown.total === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-[#8C8981] mt-0.5">{activeDrilldown.description}</p>
                </div>
              </div>

              {activeDrilldown.items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E6E4DD] bg-[#FCFBF8] p-8 text-center text-sm text-[#8C8981]">
                  No records match this KPI right now.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[#E6E4DD]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F4F1EA] text-xs uppercase tracking-[0.18em] text-[#8C8981]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Record</th>
                        <th className="px-4 py-3 font-semibold">Client</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold">Amount</th>
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold text-right">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E4DD]">
                      {activeDrilldown.items.map((item) => (
                        <tr className="hover:bg-[#FCFBF8]" key={`${item.routeType}-${item.id}`}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[#2C2B29]">{item.title}</p>
                            <p className="text-xs text-[#8C8981] mt-0.5">{item.subtitle || item.matterTitle || item.id}</p>
                          </td>
                          <td className="px-4 py-3 text-[#5A7C96]">{item.clientName || '—'}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-[#F4F1EA] px-2.5 py-1 text-xs text-[#2C2B29]">
                              {item.status || 'open'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#2C2B29]">
                            {typeof item.amount === 'number' ? formatCurrency(item.amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-[#8C8981]">{item.date ? String(item.date).slice(0, 10) : '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              className="inline-flex items-center gap-1 text-sm text-[#2C2B29] hover:text-[#997A48]"
                              onClick={() => openRecord(item)}
                              type="button"
                            >
                              Open <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#E6E4DD] bg-[#FCFBF8] p-8 text-center text-sm text-[#8C8981]">
              Select a KPI card to view its matching records.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-[#E6E4DD]">
            <h3 className="font-medium text-[#2C2B29]">Revenue: Year-over-Year</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">
              Current collections versus the same months one year earlier.
            </p>
          </div>
          <div className="p-5">
            <div className="h-[320px] rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] p-5">
              <div className="h-full grid grid-cols-4 md:grid-cols-8 gap-4 items-end">
                {workspace.revenueTrend.map((point) => (
                  <div className="flex flex-col items-center gap-3 min-w-0" key={point.month}>
                    <div className="w-full h-full flex items-end justify-center gap-2">
                      <div
                        className="w-5 rounded-t-md bg-[#D9D4C6]"
                        style={{ height: `${Math.max(14, (point.previousRevenue / maxRevenue) * 220)}px` }}
                        title={`Previous ${formatCurrency(point.previousRevenue)}`}
                      />
                      <div
                        className="w-5 rounded-t-md bg-[#C19A5B]"
                        style={{ height: `${Math.max(18, (point.currentRevenue / maxRevenue) * 220)}px` }}
                        title={`Current ${formatCurrency(point.currentRevenue)}`}
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-medium text-[#2C2B29]">{point.month}</p>
                      <p className="text-[11px] text-[#8C8981]">{formatCurrency(point.currentRevenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-[#8C8981]">
              <LegendSwatch color="bg-[#C19A5B]" label="Current" />
              <LegendSwatch color="bg-[#D9D4C6]" label="Previous Year" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-[#E6E4DD]">
            <h3 className="font-medium text-[#2C2B29]">Stage Mix</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">Where active matters are accumulating.</p>
          </div>
          <div className="p-5 space-y-4">
            {workspace.stageMix.map((entry) => (
              <div key={entry.label}>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-[#2C2B29]">{entry.label}</span>
                  <span className="text-[#8C8981]">{entry.value}</span>
                </div>
                <div className="h-3 rounded-full bg-[#F4F1EA] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#5A7C96]"
                    style={{
                      width: `${Math.min(
                        100,
                        (entry.value /
                          Math.max(...workspace.stageMix.map((item) => item.value), 1)) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-[#E6E4DD]">
            <h3 className="font-medium text-[#2C2B29]">Intake Conversion Trend</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">New leads versus request-to-matter conversions.</p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4 items-end h-[240px]">
              {workspace.intakeTrend.map((entry) => {
                const maxValue = Math.max(
                  ...workspace.intakeTrend.flatMap((item) => [item.leads, item.converted]),
                  1
                );

                return (
                  <div className="flex flex-col items-center gap-3" key={entry.month}>
                    <div className="w-full h-full flex items-end justify-center gap-2">
                      <div
                        className="w-5 rounded-t-md bg-[#D6E4EE]"
                        style={{ height: `${Math.max(16, (entry.leads / maxValue) * 160)}px` }}
                      />
                      <div
                        className="w-5 rounded-t-md bg-[#5A7C96]"
                        style={{ height: `${Math.max(12, (entry.converted / maxValue) * 160)}px` }}
                      />
                    </div>
                    <div className="text-center text-xs">
                      <p className="font-medium text-[#2C2B29]">{entry.month}</p>
                      <p className="text-[#8C8981]">{entry.converted}/{entry.leads}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-[#E6E4DD]">
            <h3 className="font-medium text-[#2C2B29]">Accounts Receivable Aging</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">Outstanding invoice exposure by aging bucket.</p>
          </div>
          <div className="p-5 grid grid-cols-2 gap-4">
            {workspace.invoiceAging.map((entry) => (
              <div className="rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] p-4" key={entry.bucket}>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F]">{entry.bucket}</p>
                <p
                  className="text-xl mt-3 text-[#2C2B29]"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {formatCurrency(entry.amount)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-[#E6E4DD]">
            <h3 className="font-medium text-[#2C2B29]">Document Review Activity</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">Current split of review state across documents.</p>
          </div>
          <div className="p-5 space-y-4">
            {workspace.documentActivity.map((entry) => (
              <div className="flex items-center justify-between rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3" key={entry.label}>
                <span className="text-sm text-[#2C2B29]">{entry.label}</span>
                <span className="text-sm font-medium text-[#5A7C96]">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden xl:col-span-2">
          <div className="p-5 border-b border-[#E6E4DD]">
            <h3 className="font-medium text-[#2C2B29]">Team Utilization</h3>
            <p className="text-xs text-[#8C8981] mt-0.5">Matter load and waiting-thread pressure by assignee.</p>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {workspace.workloadByAssignee.map((entry) => (
              <div className="rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] p-4" key={entry.label}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#2C2B29]">{entry.label}</p>
                    <p className="text-xs text-[#8C8981] mt-1">
                      {entry.activeMatters} active matters • {entry.waitingThreads} waiting threads
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-medium text-[#2C2B29]">{entry.utilizationRate}%</p>
                    <p className="text-[11px] text-[#8C8981] uppercase tracking-[0.18em]">utilization</p>
                  </div>
                </div>
                <div className="h-3 rounded-full bg-white border border-[#E6E4DD] overflow-hidden mt-4">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#C19A5B] to-[#5A7C96]"
                    style={{ width: `${Math.min(100, entry.utilizationRate)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-[#E6E4DD]">
          <h3 className="font-medium text-[#2C2B29]">Resolution Time by Practice</h3>
          <p className="text-xs text-[#8C8981] mt-0.5">Average matter close time for completed work.</p>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {workspace.resolutionTimes.map((entry) => (
            <div className="rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] p-4" key={entry.label}>
              <p className="text-sm font-medium text-[#2C2B29]">{entry.label}</p>
              <p
                className="text-2xl mt-3 text-[#2C2B29]"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {entry.days}
              </p>
              <p className="text-xs text-[#8C8981] mt-1">average days</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ReportMetricCard = ({
  accent,
  icon: Icon,
  label,
  trend,
  trendLabel,
  value,
}: {
  accent: 'blue' | 'gold' | 'rose' | 'violet';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  trend: 'down' | 'neutral' | 'up';
  trendLabel: string;
  value: string;
}) => {
  const accentClasses = {
    blue: 'bg-[#EFF3F6] text-[#5A7C96]',
    gold: 'bg-[#FDF8EF] text-[#C19A5B]',
    rose: 'bg-[#FDE8EC] text-[#d4183d]',
    violet: 'bg-[#F3F0FF] text-[#7C3AED]',
  }[accent];

  const trendNode =
    trend === 'up' ? (
      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
    ) : trend === 'down' ? (
      <ArrowDownRight className="w-3.5 h-3.5 text-rose-600" />
    ) : (
      <Layers className="w-3.5 h-3.5 text-[#8C8981]" />
    );

  return (
    <div className="bg-white border border-[#E6E4DD] p-5 rounded-xl shadow-sm">
      <div className="flex justify-between items-start gap-3 mb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accentClasses}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="flex items-center gap-1 text-xs font-medium text-[#8C8981]">
          {trendNode}
          {trendLabel}
        </span>
      </div>
      <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#A8A69F]">{label}</p>
      <p
        className="text-2xl mt-3 text-[#2C2B29]"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {value}
      </p>
    </div>
  );
};

const DrilldownKpiCard = ({
  active,
  label,
  tone,
  value,
}: {
  active: boolean;
  label: string;
  tone: 'amber' | 'blue' | 'emerald' | 'neutral' | 'rose' | 'violet';
  value: string;
}) => {
  const toneClasses: Record<typeof tone, string> = {
    amber: 'bg-[#FDF8EF] border-[#EAD2A8] text-[#997A48]',
    blue: 'bg-[#EFF3F6] border-[#D6E4EE] text-[#5A7C96]',
    emerald: 'bg-[#EEF9F1] border-[#CFE8D5] text-[#2e7d32]',
    neutral: 'bg-[#FCFBF8] border-[#E6E4DD] text-[#2C2B29]',
    rose: 'bg-[#FDE8EC] border-[#F5C2C7] text-[#d4183d]',
    violet: 'bg-[#F3F0FF] border-[#DDD6FE] text-[#7C3AED]',
  };

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm transition hover:shadow-md ${
        active ? 'ring-2 ring-[#C19A5B] ring-offset-2' : ''
      } ${toneClasses[tone]}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-70">{label}</p>
      <p
        className="mt-3 text-xl text-[#2C2B29]"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {value}
      </p>
    </div>
  );
};

const LegendSwatch = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-2">
    <span className={`w-3 h-3 rounded-full ${color}`} />
    {label}
  </span>
);
