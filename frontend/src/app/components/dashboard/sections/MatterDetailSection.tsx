import React from 'react';
import {
  ArrowLeft,
  Download,
  Eye,
  ExternalLink,
  FileText,
  MessageSquare,
  Video,
} from 'lucide-react';
import { LifecycleStepper } from '../LifecycleStepper';
import { StatusBadge, UrgencyDot } from '../StatusBadge';
import { formatCurrency, formatDate, getServiceName } from '../../../utils/dashboardFormatting';
import type {
  Invoice,
  Matter,
  MatterPackage,
  MessageThread,
  PlatformDocument,
  PlatformEvent,
} from '../../../data/dashboardTypes';

interface MatterDetailSectionProps {
  activeTab: string;
  isSelectingPackage: boolean;
  matterPackages: MatterPackage[];
  selectedMatter: Matter;
  myInvoices: Invoice[];
  myDocs: PlatformDocument[];
  myEvents: PlatformEvent[];
  myThreads: MessageThread[];
  onBack: () => void;
  onDownloadDocument: (documentId: string) => void;
  onPreviewDocument: (documentId: string) => void;
  onOpenBilling: () => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenMessagesForMatter: (threadId: string | null) => void;
  onSelectPackage: (
    matterId: string,
    matterPackageId: string,
    proposalVersion: number
  ) => Promise<void>;
  formatSize: (bytes: number) => string;
}

export const MatterDetailSection = ({
  activeTab,
  isSelectingPackage,
  matterPackages,
  selectedMatter,
  myInvoices,
  myDocs,
  myEvents,
  myThreads,
  onBack,
  onDownloadDocument,
  onPreviewDocument,
  onOpenBilling,
  onOpenInvoice,
  onOpenMessagesForMatter,
  onSelectPackage,
  formatSize,
}: MatterDetailSectionProps) => {
  const matterInvoices = myInvoices.filter((invoice) => invoice.matterId === selectedMatter.id);
  const matterDocuments = myDocs.filter((document) => document.matterId === selectedMatter.id);
  const matterEvents = myEvents.filter((event) => event.matterId === selectedMatter.id);
  const liveProposalPackages = matterPackages.filter(
    (entry) => entry.proposalStatus === 'published' || entry.proposalStatus === 'selected'
  );
  const activeProposalVersion = liveProposalPackages.reduce(
    (highestVersion, entry) => Math.max(highestVersion, entry.proposalVersion),
    0
  );
  const activeProposalPackages = liveProposalPackages
    .filter((entry) => entry.proposalVersion === activeProposalVersion)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
  const selectedPackage =
    matterPackages.find((entry) => entry.isSelected) ||
    activeProposalPackages.find((entry) => entry.isSelected) ||
    null;
  const activeSelectionLocked = Boolean(selectedPackage);
  const hasReplacementProposal =
    Boolean(selectedPackage) &&
    activeProposalPackages.length > 0 &&
    !activeProposalPackages.some((entry) => entry.id === selectedPackage?.id);
  const safePreviewTypes = new Set(['CSV', 'GIF', 'JPG', 'JPEG', 'PDF', 'PNG', 'TXT', 'WEBP']);
  const matterCurrencyCode = selectedMatter.currencyCode || matterInvoices[0]?.currencyCode || 'USD';

  return (
    <div className="min-w-0 space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to {activeTab === 'cases' ? 'My Cases' : 'Dashboard'}
      </button>

      <div className="max-w-full overflow-hidden rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl" style={{ fontFamily: "'Playfair Display', serif" }}>
                {selectedMatter.title}
              </h1>
              <span className="break-all font-mono text-xs text-gray-400">{selectedMatter.referenceCode}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selectedMatter.operationalStatus} size="md" />
              <StatusBadge status={selectedMatter.priority} size="md" />
              <UrgencyDot urgency={selectedMatter.urgency} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {selectedMatter.meetingLink && (
              <a
                href={selectedMatter.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100"
              >
                <Video className="h-3.5 w-3.5" /> Join Call
              </a>
            )}
            <button
              type="button"
              onClick={() =>
                onOpenMessagesForMatter(
                  myThreads.find((thread) => thread.matterId === selectedMatter.id)?.id || null
                )
              }
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Chat
            </button>
          </div>
        </div>

        <div className="mb-6 overflow-x-auto pb-2">
          <div className="min-w-[28rem] sm:min-w-0">
            <LifecycleStepper stages={selectedMatter.stages} />
          </div>
        </div>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="min-w-0 space-y-6">
            <div>
              <h3 className="mb-2 text-sm text-gray-500">Issue Summary</h3>
              <p className="break-words rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                {selectedMatter.issueSummary}
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-sm text-gray-500">Selected Services</h3>
              <div className="flex flex-wrap gap-2">
                {selectedMatter.selectedServices.map((serviceId) => (
                  <span key={serviceId} className="rounded-full bg-gray-100 px-3 py-1 text-xs">
                    {getServiceName(serviceId)}
                  </span>
                ))}
              </div>
            </div>

            {(activeProposalPackages.length > 0 || selectedPackage) && (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm text-gray-500">Service Proposal</h3>
                    <p className="mt-1 text-xs text-gray-400">
                      Review the current package options for this matter. Selecting a package will
                      generate the invoice automatically.
                    </p>
                  </div>
                  {activeProposalVersion > 0 && (
                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                      Proposal v{activeProposalVersion}
                    </span>
                  )}
                </div>

                {hasReplacementProposal && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    A newer proposal version is available. Your selected package remains unchanged unless
                    the Global LMG team explicitly updates it.
                  </div>
                )}

                {selectedPackage && !activeProposalPackages.some((pkg) => pkg.id === selectedPackage.id) && (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Current selected package: <span className="font-semibold">{selectedPackage.name}</span>
                    {' '}from proposal v{selectedPackage.proposalVersion}.
                  </div>
                )}

                <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {activeProposalPackages.map((pkg) => {
                    const isLocked = activeSelectionLocked && !pkg.isSelected;
                    return (
                      <div
                        key={pkg.id}
                        className={`relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-white p-5 shadow-sm ${
                          pkg.isRecommended
                            ? 'border-gray-900 ring-1 ring-gray-900/10'
                            : 'border-gray-200'
                        }`}
                      >
                        <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row">
                          <div className="min-w-0">
                            <h4 className="break-words text-base font-semibold text-gray-900">{pkg.name}</h4>
                            <p className="mt-1 break-words text-sm text-gray-500">
                              {pkg.description || 'Custom package tailored to this matter.'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
                            {pkg.isRecommended && (
                              <span className="rounded-full bg-gray-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
                                Recommended
                              </span>
                            )}
                            {pkg.isSelected && (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                                Selected
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="mb-5 text-2xl font-semibold text-gray-900">
                          {formatCurrency(pkg.price, pkg.currencyCode || matterCurrencyCode)}
                        </div>

                        <div className="flex-1 space-y-2">
                          {(pkg.features.length > 0 ? pkg.features : pkg.services.map(getServiceName)).map(
                            (feature, index) => (
                              <div key={`${pkg.id}-${index}`} className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
                                <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                                <span className="min-w-0 break-words">{feature}</span>
                              </div>
                            )
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={pkg.isSelected || isSelectingPackage || isLocked}
                          onClick={() =>
                            void onSelectPackage(selectedMatter.id, pkg.id, pkg.proposalVersion)
                          }
                          className={`mt-6 w-full rounded-lg py-2.5 text-sm font-medium transition ${
                            pkg.isSelected
                              ? 'cursor-default border border-emerald-200 bg-emerald-50 text-emerald-700'
                              : isLocked
                                ? 'cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400'
                                : 'bg-gray-900 text-white hover:bg-gray-800'
                          }`}
                        >
                          {pkg.isSelected
                            ? 'Selected Package'
                            : isSelectingPackage
                              ? 'Confirming...'
                              : isLocked
                                ? 'Selection Locked'
                                : 'Select Package'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedMatter.clientVisibleNotes.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm text-gray-500">Updates</h3>
                <div className="space-y-2">
                  {selectedMatter.clientVisibleNotes.map((note, index) => (
                    <div key={index} className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
                      <div className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                      <span className="min-w-0 break-words">{note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {matterDocuments.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm text-gray-500">Documents</h3>
                <div className="space-y-2">
                  {matterDocuments.map((document) => (
                    <div
                      key={document.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-4 py-2"
                    >
                      <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 break-words text-sm sm:truncate">{document.name}</span>
                      <span className="shrink-0 text-xs text-gray-400">{formatSize(document.size)}</span>
                      <button
                        type="button"
                        disabled={!safePreviewTypes.has(document.type.toUpperCase())}
                        onClick={() => onPreviewDocument(document.id)}
                        title={
                          safePreviewTypes.has(document.type.toUpperCase())
                            ? 'Preview document'
                            : 'Preview unavailable for this file type'
                        }
                        className="rounded p-1 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Eye className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadDocument(document.id)}
                        className="rounded p-1 hover:bg-gray-200"
                      >
                        <Download className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {matterEvents.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm text-gray-500">Upcoming Events</h3>
                {matterEvents.map((event) => (
                  <div key={event.id} className="space-y-1 rounded-lg bg-gray-50 px-4 py-3">
                    <p className="break-words text-sm">{event.title}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(event.date)} · {event.time} · {event.location || 'Video'}
                    </p>
                    {event.meetLink && (
                      <a
                        href={event.meetLink}
                        className="flex min-w-0 items-center gap-1 break-all text-xs text-blue-600 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Join Call
                      </a>
                    )}
                    {event.googleAttendeeStatus === 'invited' && (
                      <p className="text-xs text-gray-400">Google Calendar invite sent to your email.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-3 rounded-xl bg-gray-50 p-4">
              <h3 className="text-xs uppercase tracking-wider text-gray-400">Fee Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Total Fee</span>
                  <span>{formatCurrency(selectedMatter.totalFee, matterCurrencyCode)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-500">Paid</span>
                  <span className="text-emerald-600">{formatCurrency(selectedMatter.paidAmount, matterCurrencyCode)}</span>
                </div>
                <div className="flex justify-between gap-3 border-t border-gray-200 pt-2">
                  <span className="text-gray-500">Due</span>
                  <span className={selectedMatter.dueAmount > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                    {formatCurrency(selectedMatter.dueAmount, matterCurrencyCode)}
                  </span>
                </div>
              </div>
              {selectedMatter.dueAmount > 0 && (
                <button
                  type="button"
                  onClick={onOpenBilling}
                  className="w-full rounded-lg bg-gray-900 py-2 text-sm text-white hover:bg-gray-800"
                >
                  View Billing
                </button>
              )}
            </div>

            {selectedPackage && (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">Selected Package</h3>
                <p className="break-words text-sm font-medium text-gray-900">{selectedPackage.name}</p>
                <p className="text-xs text-gray-500">
                  Proposal v{selectedPackage.proposalVersion} · {formatCurrency(selectedPackage.price, selectedPackage.currencyCode || matterCurrencyCode)}
                </p>
                {selectedPackage.selectedAt && (
                  <p className="text-xs text-gray-500">
                    Selected on {formatDate(selectedPackage.selectedAt)}
                  </p>
                )}
              </div>
            )}

            {selectedMatter.assignments?.some((entry) => entry.type === 'external_counsel') ? (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">External Counsel Contact</h3>
                <div className="space-y-1 text-sm">
                  {selectedMatter.assignments
                    .filter((entry) => entry.type === 'external_counsel')
                    .map((entry) => (
                      <p key={entry.id} className="break-words">{entry.name}</p>
                    ))}
                </div>
              </div>
            ) : selectedMatter.assignedCounsel ? (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">External Counsel Contact</h3>
                <p className="break-words text-sm">{selectedMatter.assignedCounsel}</p>
              </div>
            ) : null}
            {selectedMatter.assignments?.some((entry) => entry.type === 'internal_staff') ? (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">Coordination Contact</h3>
                <div className="space-y-1 text-sm">
                  {selectedMatter.assignments
                    .filter((entry) => entry.type === 'internal_staff')
                    .map((entry) => (
                      <p key={entry.id} className="break-words">{entry.name}</p>
                    ))}
                </div>
              </div>
            ) : selectedMatter.assignedStaff ? (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">Coordination Contact</h3>
                <p className="break-words text-sm">{selectedMatter.assignedStaff}</p>
              </div>
            ) : null}
            {selectedMatter.assignments?.some((entry) => entry.type === 'field_partner') ? (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">Field Support Contact</h3>
                <div className="space-y-1 text-sm">
                  {selectedMatter.assignments
                    .filter((entry) => entry.type === 'field_partner')
                    .map((entry) => (
                      <p key={entry.id} className="break-words">{entry.name}</p>
                    ))}
                </div>
              </div>
            ) : null}

            <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
              <h3 className="text-xs uppercase tracking-wider text-gray-400">Details</h3>
              <div className="space-y-1.5 text-xs text-gray-500">
                <p className="break-words">Expertise: {selectedMatter.expertiseArea}</p>
                <p className="break-words">Mode: {selectedMatter.consultationMode}</p>
                <p>Created: {formatDate(selectedMatter.createdAt)}</p>
                <p>Last Updated: {formatDate(selectedMatter.lastUpdated)}</p>
              </div>
            </div>

            {matterInvoices.length > 0 && (
              <div className="min-w-0 space-y-2 rounded-xl bg-gray-50 p-4">
                <h3 className="text-xs uppercase tracking-wider text-gray-400">Invoices</h3>
                {matterInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => onOpenInvoice(invoice.id)}
                      className="break-all font-mono text-left text-gray-700 transition hover:text-gray-900 hover:underline"
                    >
                      {invoice.id}
                    </button>
                    <span className="shrink-0">{formatCurrency(invoice.totalAmount, invoice.currencyCode)}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={invoice.status} />
                      <button
                        type="button"
                        onClick={() => onOpenInvoice(invoice.id)}
                        className="rounded border border-gray-200 px-2 py-1 text-[11px] hover:bg-white"
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
