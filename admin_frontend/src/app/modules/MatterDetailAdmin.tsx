import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Video, MessageSquare, FileText, Download,
  Edit2, Clock, Check, Eye,
  Package, Save, Calendar, Upload, Search, X
} from 'lucide-react';
import { StatusBadge, UrgencyDot } from '../components/dashboard/StatusBadge';
import { LifecycleStepper } from '../components/dashboard/LifecycleStepper';
import { formatCurrency, formatDate } from '../data/formatters';
import { getServiceName, LIFECYCLE_STAGES } from '../data/referenceData';
import type { Matter, Invoice, PlatformEvent, PlatformDocument, MessageThread } from '../data/adminTypes';
import type { MatterPackageProposalsResponse } from '../lib/api/contracts';
import { PackageBuilder, type PackageTier } from './PackageBuilder';

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const SAFE_DOCUMENT_PREVIEW_TYPES = new Set(['CSV', 'GIF', 'JPG', 'JPEG', 'PDF', 'PNG', 'TXT', 'WEBP']);
const ACCEPTED_UPLOAD_TYPES = '.csv,.doc,.docx,.gif,.jpg,.jpeg,.pdf,.png,.txt,.webp,.xls,.xlsx,.zip';

type AssignmentOption = {
  city?: string | null;
  country?: string | null;
  email?: string | null;
  id: string;
  name: string;
  phone?: string | null;
  specialization?: string | null;
  state?: string | null;
  type?: 'external_counsel' | 'field_partner';
};

interface MatterDetailAdminProps {
  assignmentOptions?: {
    counsel: AssignmentOption[];
    staff: AssignmentOption[];
  };
  matter: Matter;
  isPackageLoading?: boolean;
  packageErrorMessage?: string | null;
  packageWorkspace?: MatterPackageProposalsResponse | null;
  serviceOptions?: Array<{ code: string; name: string }>;
  onAddMatterNote?: (payload: { bodyText: string; title: string; visibleToClient?: boolean }) => Promise<void>;
  onArchiveProposal?: (proposalVersion: number) => Promise<void>;
  onAssignMatter?: (payload: {
    assignmentRoleCode: string;
    counselPartnerId?: string;
    internalUserId?: string;
    isPrimary?: boolean;
    notes?: string;
    visibleToClient?: boolean;
  }) => Promise<void>;
  onReplaceMatterAssignments?: (payload: {
    externalCounsel: Array<{ id: string; visibleToClient: boolean }>;
    fieldPartners: Array<{ id: string; visibleToClient: boolean }>;
    staff: Array<{ id: string; visibleToClient: boolean }>;
  }) => Promise<void>;
  onBack: () => void;
  onChat: (threadId: string | null) => void;
  onCreateEvent?: (payload: {
    clientAccountId?: string;
    date: string;
    durationMinutes?: number;
    matterId?: string;
    meetLink?: string;
    mode: string;
    notes?: string;
    time: string;
    title: string;
    type: string;
    visibleToClient?: boolean;
  }) => Promise<void>;
  onSaveMatterDetails?: (payload: {
    issueSummary?: string;
    operationalStatusCode?: string;
    priorityCode?: string;
    quotedTotalAmount?: number;
    selectedServices?: string[];
  }) => Promise<void>;
  onSavePackageDraft?: (packages: PackageTier[]) => Promise<void>;
  onOverridePackageSelection?: (matterPackageId: string, reasonText: string) => Promise<void>;
  onPublishProposal?: (proposalVersion: number) => Promise<void>;
  onUpdateStage?: (payload: {
    changeNote?: string;
    operationalStatusCode?: string;
    stageCode: string;
    visibleToClient?: boolean;
  }) => Promise<void>;
  buildDocumentDownloadUrl?: (documentId: string) => string;
  buildDocumentPreviewUrl?: (documentId: string) => string;
  myInvoices: Invoice[];
  myDocs: PlatformDocument[];
  myEvents: PlatformEvent[];
  myThreads: MessageThread[];
  onUpdateDocumentControls?: (
    documentId: string,
    payload: { reviewState: 'reviewed' | 'unreviewed'; visibility: 'client' | 'internal' }
  ) => Promise<void>;
  onUpdateFee?: (matterId: string, newFee: number) => Promise<void> | void;
  onUploadDocument?: (payload: {
    file: File;
    reviewState: 'reviewed' | 'unreviewed';
    visibility: 'client' | 'internal';
  }) => Promise<void>;
}

type AssignmentDraft = {
  externalCounsel: Array<{ id: string; visibleToClient: boolean }>;
  fieldPartners: Array<{ id: string; visibleToClient: boolean }>;
  staff: Array<{ id: string; visibleToClient: boolean }>;
};

type AssignmentGroup = keyof AssignmentDraft;

const normalizeAssignmentDraft = (draft: AssignmentDraft) => ({
  externalCounsel: [...draft.externalCounsel].sort((a, b) => a.id.localeCompare(b.id)),
  fieldPartners: [...draft.fieldPartners].sort((a, b) => a.id.localeCompare(b.id)),
  staff: [...draft.staff].sort((a, b) => a.id.localeCompare(b.id)),
});

const getAssignmentSearchText = (option: AssignmentOption) =>
  [
    option.name,
    option.email,
    option.phone,
    option.specialization,
    option.city,
    option.state,
    option.country,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const compactAssignmentMeta = (option?: AssignmentOption) =>
  [option?.specialization, option?.city, option?.state].filter(Boolean).join(' · ');

const AssignmentMultiSelect: React.FC<{
  draft: Array<{ id: string; visibleToClient: boolean }>;
  fallbackAssignments: NonNullable<Matter['assignments']>;
  group: AssignmentGroup;
  label: string;
  onAdd: (group: AssignmentGroup, id: string) => void;
  onRemove: (group: AssignmentGroup, id: string) => void;
  onVisibilityChange: (group: AssignmentGroup, id: string, visibleToClient: boolean) => void;
  options: AssignmentOption[];
  placeholder: string;
  roleLabel: string;
}> = ({
  draft,
  fallbackAssignments,
  group,
  label,
  onAdd,
  onRemove,
  onVisibilityChange,
  options,
  placeholder,
  roleLabel,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const selectedIds = useMemo(() => new Set(draft.map((entry) => entry.id)), [draft]);
  const optionById = useMemo(() => {
    const lookup = new Map<string, AssignmentOption>();
    options.forEach((option) => lookup.set(option.id, option));
    fallbackAssignments.forEach((assignment) => {
      if (!lookup.has(assignment.id)) {
        lookup.set(assignment.id, {
          id: assignment.id,
          name: assignment.name,
          type: assignment.type === 'internal_staff' ? undefined : assignment.type,
        });
      }
    });
    return lookup;
  }, [fallbackAssignments, options]);

  const filteredOptions = useMemo(() => {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    return options
      .filter((option) => !selectedIds.has(option.id))
      .filter((option) => {
        if (tokens.length === 0) {
          return true;
        }
        const searchText = getAssignmentSearchText(option);
        return tokens.every((token) => searchText.includes(token));
      })
      .slice(0, 10);
  }, [options, query, selectedIds]);

  const selectedEntries = draft.map((entry) => ({
    ...entry,
    option: optionById.get(entry.id),
  }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
          <p className="mt-1 text-[11px] text-gray-400">
            Search active registry entries; selected contacts appear below.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
          {draft.length} selected
        </span>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          aria-label={`Search ${label}`}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-9 text-sm text-gray-700 outline-none transition focus:border-[#C19A5B] focus:bg-white"
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          type="search"
          value={query}
        />
        {query ? (
          <button
            aria-label={`Clear ${label} search`}
            className="absolute right-2 top-2 rounded-md p-1 text-gray-400 transition hover:bg-white hover:text-gray-700"
            onClick={() => {
              setQuery('');
              setIsOpen(true);
            }}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}

        {isOpen ? (
          <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
            {filteredOptions.length ? (
              <div className="space-y-1">
                {filteredOptions.map((option) => (
                  <button
                    className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                    key={option.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onAdd(group, option.id);
                      setQuery('');
                      setIsOpen(false);
                    }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800">{option.name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {compactAssignmentMeta(option) || roleLabel}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                        {roleLabel}
                      </span>
                    </div>
                    {[option.email, option.phone].filter(Boolean).length ? (
                      <p className="mt-1 truncate text-xs text-gray-400">
                        {[option.email, option.phone].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-4 text-center text-xs text-gray-400">
                {options.length ? 'No matching active entries.' : 'No active entries configured.'}
              </p>
            )}
            <button
              className="mt-2 w-full rounded-lg border border-gray-100 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-50"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
        ) : null}
      </div>

      {selectedEntries.length ? (
        <div className="mt-3 flex flex-col gap-2">
          {selectedEntries.map((entry) => (
            <div
              className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
              key={entry.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 admin-wrap-anywhere">
                    {entry.option?.name || entry.id}
                  </p>
                  <p className="text-xs text-gray-500 admin-wrap-anywhere">
                    {compactAssignmentMeta(entry.option) || roleLabel}
                  </p>
                </div>
                <button
                  aria-label={`Remove ${entry.option?.name || entry.id}`}
                  className="shrink-0 rounded-md p-1 text-gray-400 transition hover:bg-white hover:text-red-600"
                  onClick={() => onRemove(group, entry.id)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                <input
                  checked={entry.visibleToClient}
                  className="h-3.5 w-3.5 accent-[#C19A5B]"
                  onChange={(event) => onVisibilityChange(group, entry.id, event.target.checked)}
                  type="checkbox"
                />
                Visible to client
              </label>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-400">
          No {label.toLowerCase()} selected.
        </div>
      )}
    </div>
  );
};

const buildAssignmentDraft = (matter: Matter): AssignmentDraft => ({
  externalCounsel: (matter.assignments || [])
    .filter((assignment) => assignment.type === 'external_counsel')
    .map((assignment) => ({ id: assignment.id, visibleToClient: assignment.visibleToClient })),
  fieldPartners: (matter.assignments || [])
    .filter((assignment) => assignment.type === 'field_partner')
    .map((assignment) => ({ id: assignment.id, visibleToClient: assignment.visibleToClient })),
  staff: (matter.assignments || [])
    .filter((assignment) => assignment.type === 'internal_staff')
    .map((assignment) => ({ id: assignment.id, visibleToClient: assignment.visibleToClient })),
});

const sanitizeAssignmentDraft = (
  draft: AssignmentDraft,
  assignmentOptions?: MatterDetailAdminProps['assignmentOptions']
): AssignmentDraft => {
  if (!assignmentOptions) {
    return draft;
  }

  const staffIds = new Set(assignmentOptions.staff.map((entry) => entry.id));
  const externalCounselIds = new Set(
    assignmentOptions.counsel
      .filter((entry) => entry.type !== 'field_partner')
      .map((entry) => entry.id)
  );
  const fieldPartnerIds = new Set(
    assignmentOptions.counsel
      .filter((entry) => entry.type === 'field_partner')
      .map((entry) => entry.id)
  );

  return {
    externalCounsel: draft.externalCounsel.filter((entry) => externalCounselIds.has(entry.id)),
    fieldPartners: draft.fieldPartners.filter((entry) => fieldPartnerIds.has(entry.id)),
    staff: draft.staff.filter((entry) => staffIds.has(entry.id)),
  };
};

export const MatterDetailAdmin: React.FC<MatterDetailAdminProps> = ({ 
  assignmentOptions,
  buildDocumentDownloadUrl,
  buildDocumentPreviewUrl,
  isPackageLoading = false,
  matter: initialMatter,
  onAddMatterNote,
  onArchiveProposal,
  onAssignMatter,
  onBack,
  onChat,
  onCreateEvent,
  onOverridePackageSelection,
  onPublishProposal,
  onReplaceMatterAssignments,
  onSaveMatterDetails,
  onSavePackageDraft,
  onUpdateFee,
  onUpdateDocumentControls,
  onUpdateStage,
  onUploadDocument,
  packageErrorMessage,
  packageWorkspace,
  serviceOptions = [],
  myInvoices,
  myDocs,
  myEvents: initialEvents,
  myThreads,
}) => {
  const [matter, setMatter] = useState(initialMatter);
  const [localEvents, setLocalEvents] = useState<PlatformEvent[]>(initialEvents);
  
  const [isEditingFee, setIsEditingFee] = useState(false);
  const [editedFee, setEditedFee] = useState(matter.totalFee.toString());
  const [isSavingPackageDraft, setIsSavingPackageDraft] = useState(false);
  const [isPublishingProposal, setIsPublishingProposal] = useState(false);
  const [isOverridingPackage, setIsOverridingPackage] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'events' | 'documents'>('overview');
  const [documentUploadFile, setDocumentUploadFile] = useState<File | null>(null);
  const [documentUploadVisibility, setDocumentUploadVisibility] = useState<'client' | 'internal'>('internal');
  const [documentUploadReviewState, setDocumentUploadReviewState] = useState<'reviewed' | 'unreviewed'>('unreviewed');
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [documentActionMessage, setDocumentActionMessage] = useState<string | null>(null);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [updatingDocumentId, setUpdatingDocumentId] = useState<string | null>(null);
  
  const [showEventForm, setShowEventForm] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editedSummary, setEditedSummary] = useState(matter.issueSummary);
  const [isEditingServices, setIsEditingServices] = useState(false);
  const [editedServices, setEditedServices] = useState<string[]>(matter.selectedServices);
  
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  const [isEditingMatter, setIsEditingMatter] = useState(false);
  const [isSavingMatter, setIsSavingMatter] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>(() => buildAssignmentDraft(initialMatter));
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);
  
  // Add Event state
  const [newEvent, setNewEvent] = useState({
    title: '', date: '', time: '', type: 'meeting', location: ''
  });

  useEffect(() => {
    setMatter(initialMatter);
    setLocalEvents(initialEvents);
    setEditedFee(initialMatter.totalFee.toString());
    setEditedSummary(initialMatter.issueSummary);
    setEditedServices(initialMatter.selectedServices);
    setAssignmentDraft(sanitizeAssignmentDraft(buildAssignmentDraft(initialMatter), assignmentOptions));
  }, [assignmentOptions, initialEvents, initialMatter]);

  const savedAssignmentDraft = sanitizeAssignmentDraft(buildAssignmentDraft(matter), assignmentOptions);
  const assignmentsChanged =
    JSON.stringify(normalizeAssignmentDraft(assignmentDraft)) !==
    JSON.stringify(normalizeAssignmentDraft(savedAssignmentDraft));

  const addAssignment = (group: AssignmentGroup, id: string) => {
    setAssignmentDraft((current) => {
      const exists = current[group].some((entry) => entry.id === id);
      if (exists) {
        return current;
      }

      return {
        ...current,
        [group]: [...current[group], { id, visibleToClient: true }],
      };
    });
  };

  const removeAssignment = (group: AssignmentGroup, id: string) => {
    setAssignmentDraft((current) => ({
      ...current,
      [group]: current[group].filter((entry) => entry.id !== id),
    }));
  };

  const setAssignmentVisibility = (group: AssignmentGroup, id: string, visibleToClient: boolean) => {
    setAssignmentDraft((current) => ({
      ...current,
      [group]: current[group].map((entry) =>
        entry.id === id ? { ...entry, visibleToClient } : entry
      ),
    }));
  };

  const saveAssignmentDraft = async () => {
    if (!onReplaceMatterAssignments || !assignmentsChanged) {
      return;
    }

    setAssignmentError(null);
    setAssignmentMessage(null);
    setIsSavingAssignments(true);
    try {
      await onReplaceMatterAssignments(assignmentDraft);
      setAssignmentMessage('Matter assignments saved.');
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : 'Unable to save assignments.');
    } finally {
      setIsSavingAssignments(false);
    }
  };

  const handleSaveFee = async () => {
    if (!onUpdateFee) {
      setIsEditingFee(false);
      return;
    }

    const fee = parseInt(editedFee.replace(/,/g, '')) || 0;
    await onUpdateFee(matter.id, fee);
    setMatter({ ...matter, totalFee: fee });
    setIsEditingFee(false);
  };

  const handleSavePackages = async (packages: PackageTier[]) => {
    if (!onSavePackageDraft) {
      return;
    }

    setIsSavingPackageDraft(true);
    try {
      await onSavePackageDraft(packages);
    } finally {
      setIsSavingPackageDraft(false);
    }
  };

  const handlePublishPackages = async () => {
    if (!packageWorkspace?.draft || !onPublishProposal) {
      return;
    }

    setIsPublishingProposal(true);
    try {
      await onPublishProposal(packageWorkspace.draft.proposalVersion);
    } finally {
      setIsPublishingProposal(false);
    }
  };

  const handleArchivePackages = async (proposalVersion: number) => {
    if (!onArchiveProposal) {
      return;
    }

    if (!window.confirm(`Archive proposal version ${proposalVersion}?`)) {
      return;
    }

    await onArchiveProposal(proposalVersion);
  };

  const handleOverridePackage = async (matterPackageId: string, packageName: string) => {
    if (!onOverridePackageSelection) {
      return;
    }

    const reasonText = window.prompt(`Why are you overriding the selection to "${packageName}"?`);
    if (!reasonText?.trim()) {
      return;
    }

    setIsOverridingPackage(true);
    try {
      await onOverridePackageSelection(matterPackageId, reasonText.trim());
    } finally {
      setIsOverridingPackage(false);
    }
  };

  const handleAddEvent = async () => {
    if (!onCreateEvent) {
      return;
    }

    const isMeeting = newEvent.type === 'meeting';
    await onCreateEvent({
      date: newEvent.date || new Date().toISOString().split('T')[0],
      durationMinutes: isMeeting ? 60 : 30,
      meetLink: isMeeting ? newEvent.location || undefined : undefined,
      mode: isMeeting ? 'video' : 'court',
      notes: '',
      time: newEvent.time || '10:00',
      title: newEvent.title || (isMeeting ? 'Scheduled Meeting' : 'New Event'),
      type: isMeeting ? 'consultation' : 'hearing',
      visibleToClient: true,
    });
    setShowEventForm(false);
    setNewEvent({ title: '', date: '', time: '', type: 'meeting', location: '' });
  };

  const handleStageUpdate = async (stageId: string) => {
    if (!onUpdateStage) {
      return;
    }

    const idx = LIFECYCLE_STAGES.findIndex(s => s.id === stageId);
    const newStages = LIFECYCLE_STAGES.map((s, i) => ({
      id: s.id as any,
      label: s.label,
      completed: i <= idx
    }));
    await onUpdateStage({
      operationalStatusCode: matter.operationalStatus,
      stageCode: stageId,
      visibleToClient: true,
    });
    setMatter({ ...matter, lifecycleStage: stageId as any, stages: newStages });
    setShowStageDropdown(false);
  };

  const handleSaveMatter = async () => {
    if (!onSaveMatterDetails) {
      setIsEditingMatter(false);
      return;
    }

    setIsSavingMatter(true);
    try {
      await onSaveMatterDetails({
        issueSummary: matter.issueSummary,
        operationalStatusCode: matter.operationalStatus,
        priorityCode: matter.priority,
        quotedTotalAmount: matter.totalFee,
        selectedServices: matter.selectedServices,
      });
      setIsEditingMatter(false);
    } finally {
      setIsSavingMatter(false);
    }
  };

  const openDocumentUrl = (url?: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  };

  const handleUploadMatterDocument = async () => {
    if (!documentUploadFile || !onUploadDocument) {
      return;
    }

    setIsUploadingDocument(true);
    setDocumentActionError(null);
    setDocumentActionMessage(null);

    try {
      await onUploadDocument({
        file: documentUploadFile,
        reviewState: documentUploadReviewState,
        visibility: documentUploadVisibility,
      });
      setDocumentUploadFile(null);
      setDocumentActionMessage('Document uploaded for this matter.');
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleUpdateDocumentControls = async (
    documentId: string,
    payload: { reviewState: 'reviewed' | 'unreviewed'; visibility: 'client' | 'internal' }
  ) => {
    if (!onUpdateDocumentControls) {
      return;
    }

    setUpdatingDocumentId(documentId);
    setDocumentActionError(null);
    setDocumentActionMessage(null);

    try {
      await onUpdateDocumentControls(documentId, payload);
      setDocumentActionMessage('Document controls updated.');
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Document controls could not be updated.');
    } finally {
      setUpdatingDocumentId(null);
    }
  };

  const STAGES_LIST = LIFECYCLE_STAGES.map(s => ({
    id: s.id, label: s.label
  }));
  const editorPackages: PackageTier[] =
    packageWorkspace?.draft?.packages?.map((pkg) => ({
      description: pkg.description,
      id: pkg.id,
      isRecommended: pkg.isRecommended,
      name: pkg.name,
      points: pkg.featurePoints,
      price: pkg.price,
    })) ||
    packageWorkspace?.active?.packages?.map((pkg) => ({
      description: pkg.description,
      id: pkg.id,
      isRecommended: pkg.isRecommended,
      name: pkg.name,
      points: pkg.featurePoints,
      price: pkg.price,
    })) ||
    [];
  const selectedPackage =
    packageWorkspace?.active?.packages.find((pkg) => pkg.isSelected) ||
    packageWorkspace?.history.flatMap((proposal) => proposal.packages).find((pkg) => pkg.isSelected) ||
    null;
	  const selectedPackageVersion =
    packageWorkspace?.active?.packages.some((pkg) => pkg.isSelected)
      ? packageWorkspace.active.proposalVersion
      : packageWorkspace?.history.find((proposal) => proposal.packages.some((pkg) => pkg.isSelected))
          ?.proposalVersion;
	  const linkedPackageInvoice =
	    packageWorkspace?.linkedInvoiceSummary || packageWorkspace?.active?.linkedInvoice || null;
  const canEditMatter = Boolean(
    onAddMatterNote ||
      onReplaceMatterAssignments ||
      onSaveMatterDetails ||
      onUpdateFee ||
      onUpdateStage
  );
  const canManagePackages = Boolean(
    onArchiveProposal ||
      onOverridePackageSelection ||
      onPublishProposal ||
      onSavePackageDraft
  );

  return (
    <div className="max-w-full min-w-0 space-y-6 overflow-x-hidden">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Matter List
      </button>

      <div className="min-w-0 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-xl font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>{matter.title}</h1>
              <span className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-0.5 rounded">{matter.referenceCode}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm text-gray-500 mb-3">
              <span>Client: <span className="font-medium text-gray-900">{matter.clientName}</span></span>
              <span>•</span>
              <span>External contact: <span className="font-medium text-gray-900">{matter.assignedCounsel || 'Unassigned'}</span></span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
	              <select
	                className={`bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-full px-3 py-1 outline-none appearance-none capitalize ${isEditingMatter ? 'cursor-pointer hover:border-gray-300' : 'opacity-80 cursor-default'}`}
	                value={matter.operationalStatus}
	                onChange={(e) => setMatter({...matter, operationalStatus: e.target.value as any})}
	                disabled={!isEditingMatter || !onSaveMatterDetails}
	              >
                {[
                  'new-lead', 'awaiting-verification', 'verification-scheduled',
                  'consultation-completed', 'fee-pending', 'package-ready',
                  'awaiting-payment', 'paid', 'work-in-progress',
                  'immediate', 'completed', 'archived'
                ].map(status => (
                  <option key={status} value={status}>{status.replace(/-/g, ' ')}</option>
                ))}
              </select>

	              <select
	                className={`bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-full px-3 py-1 outline-none appearance-none capitalize ${isEditingMatter ? 'cursor-pointer hover:border-gray-300' : 'opacity-80 cursor-default'}`}
	                value={matter.priority}
	                onChange={(e) => setMatter({...matter, priority: e.target.value as any})}
	                disabled={!isEditingMatter || !onSaveMatterDetails}
	              >
                {[
                  'in-progress', 'immediate-6h', 'awaiting-client', 'awaiting-team', 'completed', 'on-hold'
                ].map(priority => (
                  <option key={priority} value={priority}>{priority.replace(/-/g, ' ')}</option>
                ))}
              </select>

              <UrgencyDot urgency={matter.urgency} />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {localEvents.some(e => e.type === 'consultation' && e.meetLink) && (
              <a 
                href={localEvents.find(e => e.type === 'consultation' && e.meetLink)?.meetLink} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="px-4 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 flex items-center gap-2 transition"
              >
                <Video className="w-4 h-4" /> Join Call
              </a>
            )}
            <button onClick={() => onChat(myThreads.find(t => t.matterId === matter.id)?.id || null)} className="px-4 py-2 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2 transition">
              <MessageSquare className="w-4 h-4" /> Open Chat
            </button>
	            {isEditingMatter ? (
	              <button
                onClick={() => void handleSaveMatter()}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 transition disabled:opacity-50"
                disabled={isSavingMatter}
              >
                <Save className="w-4 h-4" /> Save Changes
	              </button>
	            ) : canEditMatter ? (
	              <button onClick={() => setIsEditingMatter(true)} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 flex items-center gap-2 transition">
	                <Edit2 className="w-4 h-4" /> Edit Matter
	              </button>
	            ) : null}
          </div>
        </div>

        {/* Stepper */}
        <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-100 relative">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Lifecycle Stage</h3>
            <div className="relative">
	              {isEditingMatter && onUpdateStage && (
                <button 
                  onClick={() => setShowStageDropdown(!showStageDropdown)} 
                  className="text-xs text-blue-600 hover:underline"
                >
                  Update Stage
                </button>
              )}
              {showStageDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 shadow-lg rounded-lg py-1 z-10">
                  {STAGES_LIST.map(s => (
                    <button 
                      key={s.id} 
                      onClick={() => handleStageUpdate(s.id)}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <LifecycleStepper stages={matter.stages} />
        </div>

        {/* Tabs */}
        <div className="mb-8 flex gap-6 overflow-x-auto border-b border-gray-200 pb-px">
          {[
            { id: 'overview', label: 'Matter Overview' },
            { id: 'events', label: `Events & Meetings (${localEvents.length})` },
            { id: 'documents', label: `Documents (${myDocs.length})` }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`whitespace-nowrap pb-3 text-sm font-medium transition border-b-2 ${activeTab === tab.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <div className="min-w-0 space-y-8">
            {activeTab === 'overview' && (
              <>
	                {/* Package Builder Section */}
	                {canManagePackages || packageWorkspace ? (
	                <div className="border-t border-gray-100 pt-6">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="flex min-w-0 items-center gap-2 text-lg font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>
                      <Package className="w-5 h-5 text-gray-400" />
                      Service Packages & Quoting
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {packageWorkspace?.draft && onArchiveProposal ? (
                        <button
                          className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                          onClick={() => void handleArchivePackages(packageWorkspace.draft!.proposalVersion)}
                          type="button"
                        >
                          Archive Draft
                        </button>
                      ) : null}
                      {packageWorkspace?.draft && onPublishProposal ? (
                        <button
                          className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-gray-800 disabled:opacity-60"
                          disabled={isPublishingProposal}
                          onClick={() => void handlePublishPackages()}
                          type="button"
                        >
                          {isPublishingProposal ? 'Publishing...' : 'Publish to Client'}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {packageErrorMessage ? (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {packageErrorMessage}
                    </p>
                  ) : isPackageLoading && !packageWorkspace ? (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                      Loading package proposal workspace...
                    </p>
                  ) : (
                    <div className="space-y-5">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-4 admin-wrap-anywhere">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                            Draft Workspace
                          </p>
                          <p className="mt-2 text-sm text-gray-700">
                            {packageWorkspace?.draft
                              ? `Version ${packageWorkspace.draft.proposalVersion} ready for final edits.`
                              : 'No draft exists yet. Save the package builder to create one.'}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-4 admin-wrap-anywhere">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                            Active Proposal
                          </p>
                          <p className="mt-2 text-sm text-gray-700">
                            {packageWorkspace?.active
                              ? `Version ${packageWorkspace.active.proposalVersion} is ${packageWorkspace.active.status}.`
                              : 'No proposal has been published to the client yet.'}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-4 admin-wrap-anywhere">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                            Invoice Link
                          </p>
                          <p className="mt-2 text-sm text-gray-700">
                            {linkedPackageInvoice
                              ? `${linkedPackageInvoice.invoiceNumber} is ${linkedPackageInvoice.statusCode}.`
                              : 'A package invoice will auto-generate after client selection.'}
                          </p>
                        </div>
                      </div>

	                      {onSavePackageDraft ? (
	                        <PackageBuilder
	                          existingPackages={editorPackages}
	                          isSaving={isSavingPackageDraft}
	                          matterId={matter.id}
	                          onSave={(packages) => void handleSavePackages(packages)}
	                          saveLabel={packageWorkspace?.draft ? 'Update Draft' : 'Save Draft'}
	                        />
	                      ) : null}

	                      {packageWorkspace?.active ? (
	                        <div className="min-w-0 space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
	                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	                            <div className="min-w-0">
	                              <h4 className="text-base font-medium text-gray-900">Client-Facing Proposal</h4>
	                              <p className="text-sm text-gray-500">
	                                Version {packageWorkspace.active.proposalVersion} · {packageWorkspace.active.status}
	                              </p>
	                            </div>
	                            {packageWorkspace.active.linkedInvoice ? (
	                              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
	                                Invoice {packageWorkspace.active.linkedInvoice.invoiceNumber}
                              </span>
                            ) : (
                              <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                                Client review open
                              </span>
                            )}
                          </div>

                          <div className="grid gap-4 admin-card-grid">
                            {packageWorkspace.active.packages.map((pkg) => (
                              <div
                                key={pkg.id}
                                className={`flex min-w-0 max-w-full flex-col rounded-xl border p-5 shadow-sm admin-wrap-anywhere ${
                                  pkg.isRecommended ? 'border-gray-900 ring-1 ring-gray-900/10' : 'border-gray-200'
                                }`}
                              >
                                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <h5 className="font-medium text-gray-900">{pkg.name}</h5>
                                    <p className="mt-1 text-sm text-gray-500">
                                      {pkg.description || 'Client-facing package description pending.'}
                                    </p>
                                  </div>
                                  <div className="flex shrink-0 flex-wrap items-start gap-2 sm:flex-col sm:items-end">
                                    {pkg.isRecommended ? (
                                      <span className="max-w-full rounded-full bg-gray-900 px-2.5 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-white">
                                        Recommended
                                      </span>
                                    ) : null}
                                    {pkg.isSelected ? (
                                      <span className="max-w-full rounded-full bg-emerald-50 px-2.5 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                                        Selected
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                <p className="mb-4 text-2xl font-semibold text-gray-900">
                                  {formatCurrency(pkg.price)}
                                </p>

                                <div className="flex-1 space-y-2">
                                  {pkg.featurePoints.map((point, index) => (
                                    <div key={`${pkg.id}-${index}`} className="flex min-w-0 items-start gap-2 text-sm text-gray-700">
                                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                                      <span className="min-w-0">{point}</span>
                                    </div>
                                  ))}
                                </div>

                                {!pkg.isSelected && selectedPackage && onOverridePackageSelection ? (
                                  <button
                                    className="mt-5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                                    disabled={isOverridingPackage}
                                    onClick={() => void handleOverridePackage(pkg.id, pkg.name)}
                                    type="button"
                                  >
                                    {isOverridingPackage ? 'Updating...' : 'Override Selection'}
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {packageWorkspace?.history.length ? (
                        <div className="min-w-0 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h4 className="text-base font-medium text-gray-900">Proposal History</h4>
                            <span className="text-xs uppercase tracking-wider text-gray-400">
                              {packageWorkspace.history.length} archived record(s)
                            </span>
                          </div>
                          <div className="space-y-3">
                            {packageWorkspace.history.map((proposal) => (
                              <div
                                key={proposal.proposalVersion}
                                className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900">
                                    Version {proposal.proposalVersion}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {proposal.status} · {proposal.packages.length} package option(s)
                                  </p>
                                </div>
                                {proposal.status === 'superseded' && onArchiveProposal ? (
                                  <button
                                    className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                                    onClick={() => void handleArchivePackages(proposal.proposalVersion)}
                                    type="button"
                                  >
                                    Archive
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
	                  )}
	                </div>
	                ) : null}

	            {/* Matter Details */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm text-gray-500 font-medium">Issue Summary</h3>
	                  {isEditingSummary ? (
                    <button
                      onClick={() => {
                        void (async () => {
                          await onSaveMatterDetails?.({ issueSummary: editedSummary });
                          setMatter({ ...matter, issueSummary: editedSummary });
                          setIsEditingSummary(false);
                        })();
                      }}
                      className="text-xs text-emerald-600 font-medium"
                    >
                      Save Summary
                    </button>
	                  ) : isEditingMatter && onSaveMatterDetails && (
                    <button onClick={() => setIsEditingSummary(true)} className="text-xs text-blue-600 hover:underline">Edit Summary</button>
                  )}
                </div>
                {isEditingSummary ? (
                  <textarea 
                    value={editedSummary}
                    onChange={(e) => setEditedSummary(e.target.value)}
                    className="w-full text-sm text-gray-700 bg-white border border-gray-300 rounded-lg px-4 py-3 min-h-[100px] outline-none focus:border-gray-500"
                  />
                ) : (
                  <p className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 admin-wrap-anywhere">{matter.issueSummary}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm text-gray-500 font-medium">Selected Services</h3>
                  {isEditingServices ? (
                    <button
                      onClick={() => {
                        void (async () => {
                          await onSaveMatterDetails?.({ selectedServices: editedServices });
                          setMatter({ ...matter, selectedServices: editedServices });
                          setIsEditingServices(false);
                        })();
                      }}
                      className="text-xs text-emerald-600 font-medium"
                    >
                      Save Services
                    </button>
	                  ) : isEditingMatter && onSaveMatterDetails && (
                    <button onClick={() => setIsEditingServices(true)} className="text-xs text-blue-600 hover:underline">Edit Services</button>
                  )}
                </div>
                
                  {isEditingServices ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                    {(serviceOptions.length
                      ? serviceOptions
                      : matter.selectedServices.map((code) => ({ code, name: getServiceName(code) }))
                    ).map(s => (
                      <label key={s.code} className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={editedServices.includes(s.code)}
                          onChange={(e) => {
                            if (e.target.checked) setEditedServices([...editedServices, s.code]);
                            else setEditedServices(editedServices.filter(id => id !== s.code));
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">
                          {s.name}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {matter.selectedServices.map(sId => (
                      <span key={sId} className="max-w-full rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 admin-wrap-anywhere">{getServiceName(sId)}</span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm text-gray-500 font-medium">Client-Visible Updates</h3>
	                  {isEditingMatter && onAddMatterNote && (
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        if (!onAddMatterNote) {
                          return;
                        }

                        const bodyText = window.prompt('Add a client-visible update');
                        if (!bodyText?.trim()) {
                          return;
                        }

                        void onAddMatterNote({
                          bodyText: bodyText.trim(),
                          title: 'Matter update',
                          visibleToClient: true,
                        });
                      }}
                      type="button"
                    >
                      + Add Update
                    </button>
                  )}
                </div>
                {matter.clientVisibleNotes.length > 0 ? (
                  <div className="space-y-2">
                    {matter.clientVisibleNotes.map((note, i) => (
                      <div key={i} className="flex min-w-0 items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm text-gray-700 admin-wrap-anywhere">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                        {note}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No updates shared with client.</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm text-gray-500 font-medium">Internal Notes</h3>
	                  {isEditingMatter && onAddMatterNote && (
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        if (!onAddMatterNote) {
                          return;
                        }

                        const bodyText = window.prompt('Add an internal note');
                        if (!bodyText?.trim()) {
                          return;
                        }

                        void onAddMatterNote({
                          bodyText: bodyText.trim(),
                          title: 'Internal note',
                          visibleToClient: false,
                        });
                      }}
                      type="button"
                    >
                      + Add Note
                    </button>
                  )}
                </div>
                {matter.internalNotes && matter.internalNotes.length > 0 ? (
                  <div className="space-y-2">
                    {matter.internalNotes.map((note, i) => (
                      <div key={i} className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-sm text-gray-700 admin-wrap-anywhere">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
                        {note}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No internal notes.</p>
                )}
              </div>
            </div>
            </>
            )}

            {activeTab === 'events' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-lg font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>Events & Meetings</h3>
                    <p className="text-sm text-gray-500">Manage case deadlines, hearings, and Google Meet calls.</p>
                  </div>
	                  {onCreateEvent ? (
	                    <button onClick={() => setShowEventForm(true)} className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-gray-800 transition">
	                      + Add Event/Meeting
	                    </button>
	                  ) : null}
                </div>

                {showEventForm && (
                  <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                    <h4 className="font-medium text-gray-900">New Event or Meeting</h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">Type</label>
                        <select 
                          value={newEvent.type}
                          onChange={e => setNewEvent({...newEvent, type: e.target.value})}
                          className="w-full text-sm border border-gray-200 rounded px-3 py-2 outline-none"
                        >
                          <option value="meeting">Video Meeting (Google Meet)</option>
                          <option value="event">General Event (Hearing, Deadline, etc.)</option>
                        </select>
                      </div>
                      
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">Title</label>
                        <input type="text" placeholder={newEvent.type === 'meeting' ? "e.g. Case Strategy Session" : "e.g. Court Hearing"} value={newEvent.title} onChange={e => setNewEvent({...newEvent, title: e.target.value})} className="w-full text-sm border border-gray-200 rounded px-3 py-2 outline-none" />
                      </div>
                      
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Date</label>
                        <input type="date" value={newEvent.date} onChange={e => setNewEvent({...newEvent, date: e.target.value})} className="w-full text-sm border border-gray-200 rounded px-3 py-2 outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Time</label>
                        <input type="time" value={newEvent.time} onChange={e => setNewEvent({...newEvent, time: e.target.value})} className="w-full text-sm border border-gray-200 rounded px-3 py-2 outline-none" />
                      </div>
                      
                      {newEvent.type === 'event' && (
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">Location / Details</label>
                          <input type="text" placeholder="e.g. High Court, Room 3" value={newEvent.location} onChange={e => setNewEvent({...newEvent, location: e.target.value})} className="w-full text-sm border border-gray-200 rounded px-3 py-2 outline-none" />
                        </div>
                      )}

                      {newEvent.type === 'meeting' && (
                        <div className="col-span-2">
                          <label className="block text-xs text-gray-500 mb-1">Meeting Link</label>
                          <input type="url" placeholder="https://meet.google.com/..." value={newEvent.location} onChange={e => setNewEvent({...newEvent, location: e.target.value})} className="w-full text-sm border border-gray-200 rounded px-3 py-2 outline-none" />
                          <div className="flex items-center gap-2 mt-3">
                            <input type="checkbox" id="send-invite" defaultChecked className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <label htmlFor="send-invite" className="text-sm text-gray-700">Send email invitation with Meet link to client</label>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
                      <button onClick={() => setShowEventForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">Cancel</button>
                      <button onClick={handleAddEvent} className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg flex items-center gap-2">
                        {newEvent.type === 'meeting' ? <><Video className="w-4 h-4" /> Schedule Meet</> : <><Calendar className="w-4 h-4"/> Add Event</>}
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {localEvents.map(evt => (
                    <div key={evt.id} className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
                      <div className="flex min-w-0 items-start gap-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex flex-col items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold">{evt.date.split('-')[2] || 'TBD'}</span>
                          <span className="text-[10px] uppercase">{evt.date ? new Date(evt.date).toLocaleString('default', { month: 'short' }) : ''}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-gray-900">{evt.title}</p>
                            <StatusBadge status={evt.type} />
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-gray-500">
                            <Clock className="w-3.5 h-3.5"/> {evt.time} {evt.duration ? `(${evt.duration}m)` : ''} {evt.location ? `• ${evt.location}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {evt.meetLink && evt.type === 'consultation' && (
                          <a href={evt.meetLink} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 rounded flex items-center gap-1.5 transition">
                            <Video className="w-3.5 h-3.5" /> Join Meet
                          </a>
                        )}
                        <button className="p-1.5 text-gray-400 hover:text-gray-900 transition"><Edit2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                  {localEvents.length === 0 && <p className="text-sm text-gray-500 italic">No events or meetings scheduled for this matter.</p>}
                </div>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-lg font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>Matter Documents</h3>
                    <p className="text-sm text-gray-500">Manage case files and adjust client visibility.</p>
                  </div>
                  <button
                    className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                    disabled={!documentUploadFile || isUploadingDocument || !onUploadDocument}
                    onClick={() => void handleUploadMatterDocument()}
                    type="button"
                  >
                    <Upload className="h-4 w-4" />
                    {isUploadingDocument ? 'Uploading...' : 'Upload'}
                  </button>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                    <input
                      accept={ACCEPTED_UPLOAD_TYPES}
                      className="min-w-0 text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:text-gray-700"
                      onChange={(event) => setDocumentUploadFile(event.target.files?.[0] || null)}
                      type="file"
                    />
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                      onChange={(event) => setDocumentUploadVisibility(event.target.value as 'client' | 'internal')}
                      value={documentUploadVisibility}
                    >
                      <option value="internal">Internal Only</option>
                      <option value="client">Client Visible</option>
                    </select>
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                      onChange={(event) => setDocumentUploadReviewState(event.target.value as 'reviewed' | 'unreviewed')}
                      value={documentUploadReviewState}
                    >
                      <option value="unreviewed">Needs Review</option>
                      <option value="reviewed">Reviewed</option>
                    </select>
                  </div>
                  {(documentActionMessage || documentActionError) && (
                    <p className={`mt-3 text-sm ${documentActionError ? 'text-red-600' : 'text-emerald-600'}`}>
                      {documentActionError || documentActionMessage}
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  {myDocs.map(doc => (
                    <div key={doc.id} className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                      <div className="p-2 bg-gray-50 rounded text-gray-400"><FileText className="w-5 h-5" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 sm:gap-3">
                          <span>{formatSize(doc.size)}</span>
                          <span>•</span>
                          <span>{formatDate(doc.uploadedAt)}</span>
                          <span>•</span>
                          <span className={`${doc.visibility === 'client' ? 'text-blue-600' : 'text-amber-600'}`}>{doc.visibility === 'client' ? 'Visible to Client' : 'Internal Only'}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <select
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                          disabled={updatingDocumentId === doc.id || !onUpdateDocumentControls}
                          onChange={(event) =>
                            void handleUpdateDocumentControls(doc.id, {
                              reviewState: doc.reviewState === 'reviewed' ? 'reviewed' : 'unreviewed',
                              visibility: event.target.value as 'client' | 'internal',
                            })
                          }
                          value={doc.visibility}
                        >
                          <option value="internal">Internal</option>
                          <option value="client">Client</option>
                        </select>
                        <select
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                          disabled={updatingDocumentId === doc.id || !onUpdateDocumentControls}
                          onChange={(event) =>
                            void handleUpdateDocumentControls(doc.id, {
                              reviewState: event.target.value as 'reviewed' | 'unreviewed',
                              visibility: doc.visibility,
                            })
                          }
                          value={doc.reviewState}
                        >
                          <option value="unreviewed">Needs Review</option>
                          <option value="reviewed">Reviewed</option>
                        </select>
                        <button
                          className="p-1.5 text-gray-400 hover:text-gray-900 transition disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!buildDocumentPreviewUrl || !SAFE_DOCUMENT_PREVIEW_TYPES.has(doc.type.toUpperCase())}
                          onClick={() => openDocumentUrl(buildDocumentPreviewUrl?.(doc.id))}
                          title={
                            SAFE_DOCUMENT_PREVIEW_TYPES.has(doc.type.toUpperCase())
                              ? 'Preview document'
                              : 'Preview unavailable for this file type'
                          }
                          type="button"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          className="p-1.5 text-gray-400 hover:text-blue-600 transition disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!buildDocumentDownloadUrl}
                          onClick={() => openDocumentUrl(buildDocumentDownloadUrl?.(doc.id))}
                          type="button"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {myDocs.length === 0 && <p className="text-sm text-gray-500 italic">No documents uploaded for this matter.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="min-w-0 space-y-4">
            <div className="relative min-w-0 space-y-4 overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm admin-wrap-anywhere">
              <div className="absolute top-0 left-0 w-full h-1 bg-gray-900" />
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Fee & Billing Summary</h3>
	                  {isEditingFee ? (
	                  <button onClick={handleSaveFee} className="text-emerald-600 hover:text-emerald-700 p-1"><Save className="w-4 h-4"/></button>
	                ) : onUpdateFee ? (
	                  <button onClick={() => setIsEditingFee(true)} className="text-gray-400 hover:text-gray-900 p-1"><Edit2 className="w-3.5 h-3.5"/></button>
	                ) : null}
              </div>
              
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-gray-50 p-2">
                  <span className="text-gray-500 font-medium">Total Fee</span>
                  {isEditingFee ? (
                    <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 w-24">
                      <span className="text-gray-500">$</span>
                      <input 
                        type="text" 
                        value={editedFee} 
                        onChange={e => setEditedFee(e.target.value)}
                        className="w-full outline-none text-right font-medium"
                      />
                    </div>
                  ) : (
                    <span className="font-semibold text-gray-900">{formatCurrency(matter.totalFee)}</span>
                  )}
                </div>
                <div className="flex flex-wrap justify-between gap-2 px-2"><span className="text-gray-500">Paid</span><span className="text-emerald-600 font-medium">{formatCurrency(matter.paidAmount)}</span></div>
                <div className="flex flex-wrap justify-between gap-2 border-t border-gray-200 px-2 pt-3"><span className="text-gray-500 font-medium">Due Balance</span><span className={`font-bold ${matter.dueAmount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatCurrency(matter.dueAmount)}</span></div>
              </div>
              {linkedPackageInvoice ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Latest package invoice: <span className="font-semibold">{linkedPackageInvoice.invoiceNumber}</span>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500">
                  Invoice will generate automatically after the client confirms a package.
                </div>
              )}
            </div>

            {selectedPackage ? (
              <div className="min-w-0 space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-5 admin-wrap-anywhere">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Selected Package</h3>
                <p className="text-sm font-medium text-gray-900">{selectedPackage.name}</p>
                <p className="text-xs text-gray-500">
                  {selectedPackageVersion ? `Proposal v${selectedPackageVersion} · ` : ''}
                  {formatCurrency(selectedPackage.price)}
                </p>
              </div>
            ) : null}

            <div className="min-w-0 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-5 admin-wrap-anywhere">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Internal Details</h3>
                <button className="text-xs text-blue-600 hover:underline" onClick={() => setIsEditingMatter(true)} type="button">
                  Edit Details
                </button>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex flex-wrap justify-between gap-2"><span className="text-gray-400">Expertise:</span> <span>{matter.expertiseArea}</span></div>
                <div className="flex flex-wrap justify-between gap-2"><span className="text-gray-400">Mode:</span> <span className="capitalize">{matter.consultationMode}</span></div>
                <div className="flex flex-wrap justify-between gap-2"><span className="text-gray-400">Created:</span> <span>{formatDate(matter.createdAt)}</span></div>
                <div className="flex flex-wrap justify-between gap-2"><span className="text-gray-400">Updated:</span> <span>{formatDate(matter.lastUpdated)}</span></div>
              </div>
              {matter.assignments?.length ? (
                <div className="space-y-2 rounded-lg border border-gray-100 bg-white p-3 text-xs text-gray-600">
                  {[
                    ['Coordination Staff', matter.assignments.filter((entry) => entry.type === 'internal_staff')],
                    ['External Counsel', matter.assignments.filter((entry) => entry.type === 'external_counsel')],
                    ['Field Partners', matter.assignments.filter((entry) => entry.type === 'field_partner')],
                  ].map(([label, entries]) =>
                    Array.isArray(entries) && entries.length ? (
                      <div key={label as string}>
                        <p className="font-medium text-gray-400">{label as string}</p>
                        <p>{entries.map((entry) => `${entry.name}${entry.visibleToClient ? '' : ' (internal)'}`).join(', ')}</p>
                      </div>
                    ) : null
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-400">
                  No coordination staff, external counsel, or field partners assigned.
                </div>
              )}
	              {isEditingMatter && assignmentOptions && onReplaceMatterAssignments ? (
                <div className="pt-3 border-t border-gray-200 space-y-3">
                  <AssignmentMultiSelect
                    draft={assignmentDraft.staff}
                    fallbackAssignments={(matter.assignments || []).filter((entry) => entry.type === 'internal_staff')}
                    group="staff"
                    label="Coordination Staff"
                    onAdd={addAssignment}
                    onRemove={removeAssignment}
                    onVisibilityChange={setAssignmentVisibility}
                    options={assignmentOptions.staff}
                    placeholder="Search staff by name, email, phone, role, or city"
                    roleLabel="Staff"
                  />
                  <AssignmentMultiSelect
                    draft={assignmentDraft.externalCounsel}
                    fallbackAssignments={(matter.assignments || []).filter((entry) => entry.type === 'external_counsel')}
                    group="externalCounsel"
                    label="External Counsel Contacts"
                    onAdd={addAssignment}
                    onRemove={removeAssignment}
                    onVisibilityChange={setAssignmentVisibility}
                    options={assignmentOptions.counsel.filter((entry) => entry.type !== 'field_partner')}
                    placeholder="Search counsel by name, email, phone, specialization, or city"
                    roleLabel="External Counsel"
                  />
                  <AssignmentMultiSelect
                    draft={assignmentDraft.fieldPartners}
                    fallbackAssignments={(matter.assignments || []).filter((entry) => entry.type === 'field_partner')}
                    group="fieldPartners"
                    label="Field Support Contacts"
                    onAdd={addAssignment}
                    onRemove={removeAssignment}
                    onVisibilityChange={setAssignmentVisibility}
                    options={assignmentOptions.counsel.filter((entry) => entry.type === 'field_partner')}
                    placeholder="Search field partners by name, email, phone, specialization, or city"
                    roleLabel="Field Partner"
                  />
                  {assignmentError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {assignmentError}
                    </div>
                  ) : null}
                  {assignmentMessage ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      {assignmentMessage}
                    </div>
                  ) : null}
                  <button
                    className="w-full text-xs font-medium bg-white border border-gray-200 rounded-lg py-2 text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!assignmentsChanged || !onReplaceMatterAssignments || isSavingAssignments}
                    onClick={() => void saveAssignmentDraft()}
                    type="button"
                  >
                    {isSavingAssignments ? 'Saving...' : 'Save Assignments'}
                  </button>
                </div>
              ) : null}
            </div>

            {myInvoices.length > 0 && (
              <div className="min-w-0 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-5 admin-wrap-anywhere">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Recent Invoices</h3>
                <div className="space-y-2">
                  {myInvoices.slice(0, 3).map(inv => (
                    <div key={inv.id} className="flex items-center justify-between gap-3 rounded border border-gray-100 bg-white p-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{formatCurrency(inv.totalAmount)}</p>
                        <p className="text-xs text-gray-400">{inv.id}</p>
                      </div>
                      <StatusBadge status={inv.status} size="sm" />
                    </div>
                  ))}
                </div>
                <button className="w-full text-xs text-gray-500 hover:text-gray-900 font-medium pt-2">View All Invoices</button>
              </div>
            )}

            {myThreads.length > 0 && (
              <div className="min-w-0 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-5">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Linked Messages</h3>
                <div className="space-y-2">
                  {myThreads.slice(0, 3).map(thread => (
                    <div key={thread.id} onClick={() => onChat(thread.id)} className="cursor-pointer group flex items-start gap-3 bg-white p-3 rounded border border-gray-100 text-sm hover:border-blue-200 transition">
                      <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                        <MessageSquare className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="font-medium text-gray-900 truncate">{thread.matterTitle || 'General'}</p>
                          {thread.unreadCount > 0 && <span className="w-2 h-2 rounded-full bg-red-500" />}
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-1">{thread.lastMessage}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => onChat(myThreads[0].id)} className="w-full text-xs text-gray-500 hover:text-gray-900 font-medium pt-2">Open Messages Desk</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
