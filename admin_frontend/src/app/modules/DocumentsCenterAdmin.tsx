import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Clock,
  Download,
  Eye,
  EyeOff,
  File,
  FileText,
  Filter,
  Image as ImageIcon,
  Package,
  Search,
  Upload,
} from 'lucide-react';
import type { Matter, PlatformDocument } from '../data/adminTypes';
import type { AdminDocumentDetailResponse, SettingsDocumentType } from '../lib/api/contracts';
import { EmptyState } from './EmptyState';

interface DocumentsCenterAdminProps {
  buildDownloadUrl?: (documentId: string) => string;
  buildPreviewUrl?: (documentId: string) => string;
  documentTypes?: SettingsDocumentType[];
  documents: PlatformDocument[];
  matters?: Matter[];
  onFetchDocumentDetail?: (documentId: string) => Promise<AdminDocumentDetailResponse>;
  onRescanDocument?: (documentId: string) => Promise<void>;
  onUpdateDocument?: (
    documentId: string,
    payload: { reviewState: 'reviewed' | 'unreviewed'; visibility: 'client' | 'internal' }
  ) => Promise<void>;
  onUploadDocument?: (payload: {
    categoryCode?: string;
    file: File;
    matterId: string;
    reviewState: 'reviewed' | 'unreviewed';
    visibility: 'client' | 'internal';
  }) => Promise<void>;
  onUploadVersion?: (
    documentId: string,
    payload: { file: File; reviewState: 'reviewed' | 'unreviewed' }
  ) => Promise<void>;
  searchQuery: string;
}

type GroupBy = 'none' | 'matter' | 'client' | 'category' | 'visibility' | 'uploadDate';

const SAFE_PREVIEW_TYPES = new Set([
  'CSV',
  'GIF',
  'JPG',
  'JPEG',
  'PDF',
  'PNG',
  'TXT',
  'WEBP',
]);

const SAFE_PREVIEW_MIME_TYPES = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);

const ACCEPTED_UPLOAD_TYPES = [
  '.csv',
  '.doc',
  '.docx',
  '.gif',
  '.jpg',
  '.jpeg',
  '.pdf',
  '.png',
  '.txt',
  '.webp',
  '.xls',
  '.xlsx',
  '.zip',
].join(',');

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const getFileIcon = (type: string, className = 'w-5 h-5') => {
  switch (type.toUpperCase()) {
    case 'PDF':
      return <FileText className={`text-red-500 ${className}`} />;
    case 'DOCX':
    case 'DOC':
      return <File className={`text-blue-500 ${className}`} />;
    case 'GIF':
    case 'JPG':
    case 'JPEG':
    case 'PNG':
    case 'WEBP':
      return <ImageIcon className={`text-emerald-500 ${className}`} />;
    case 'ZIP':
      return <Package className={`text-amber-500 ${className}`} />;
    case 'XLS':
    case 'XLSX':
      return <File className={`text-green-600 ${className}`} />;
    default:
      return <File className={`text-gray-400 ${className}`} />;
  }
};

const canPreviewDocument = (
  document: PlatformDocument,
  detail: AdminDocumentDetailResponse | null
) => {
  const mimeType = detail?.latestVersion?.mimeType?.toLowerCase();
  if (mimeType) {
    return SAFE_PREVIEW_MIME_TYPES.has(mimeType);
  }

  return SAFE_PREVIEW_TYPES.has(document.type.toUpperCase());
};

const getScanStatus = (document: PlatformDocument, detail: AdminDocumentDetailResponse | null) =>
  detail?.latestVersion?.virusStatus || document.virusStatus || 'unscanned';

const scanStatusMeta = (status: string) => {
  switch (status) {
    case 'clean':
      return { label: 'Scan clean', tone: 'bg-emerald-100 text-emerald-700' };
    case 'infected':
    case 'blocked':
    case 'quarantined':
      return { label: 'Blocked: malware detected', tone: 'bg-red-100 text-red-700' };
    case 'scan_failed':
      return { label: 'Scan failed', tone: 'bg-red-50 text-red-700' };
    case 'scan_skipped_manual_mode':
      return { label: 'Not virus scanned', tone: 'bg-amber-100 text-amber-700' };
    case 'pending_scan':
      return { label: 'Scan pending', tone: 'bg-blue-100 text-blue-700' };
    default:
      return { label: 'Unscanned', tone: 'bg-amber-100 text-amber-700' };
  }
};

const canDownloadByScanStatus = (status: string) =>
  !['blocked', 'infected', 'quarantined'].includes(status);

const canPreviewByScanStatus = (status: string) => status === 'clean';

export const DocumentsCenterAdmin: React.FC<DocumentsCenterAdminProps> = ({
  buildDownloadUrl,
  buildPreviewUrl,
  documentTypes = [],
  documents,
  matters = [],
  onFetchDocumentDetail,
  onRescanDocument,
  onUpdateDocument,
  onUploadDocument,
  onUploadVersion,
  searchQuery: globalSearch,
}) => {
  const [localSearch, setLocalSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [selectedDoc, setSelectedDoc] = useState<PlatformDocument | null>(documents[0] || null);
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'client' | 'internal'>('all');
  const [reviewFilter, setReviewFilter] = useState<'all' | 'reviewed' | 'unreviewed'>('all');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadCategoryCode, setUploadCategoryCode] = useState('');
  const [uploadMatterId, setUploadMatterId] = useState('');
  const [uploadVisibility, setUploadVisibility] = useState<'client' | 'internal'>('internal');
  const [uploadReviewState, setUploadReviewState] = useState<'reviewed' | 'unreviewed'>('unreviewed');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionReviewState, setVersionReviewState] = useState<'reviewed' | 'unreviewed'>('unreviewed');
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);
  const [isUpdatingControls, setIsUpdatingControls] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [documentDetail, setDocumentDetail] = useState<AdminDocumentDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const activeDocumentTypes = useMemo(
    () => documentTypes.filter((documentType) => documentType.isActive),
    [documentTypes]
  );
  const selectedUploadDocumentType = useMemo(
    () =>
      activeDocumentTypes.find((documentType) => documentType.code === uploadCategoryCode) ||
      activeDocumentTypes[0] ||
      null,
    [activeDocumentTypes, uploadCategoryCode]
  );
  const acceptedUploadTypes = useMemo(() => {
    if (!selectedUploadDocumentType?.allowedExtensions.length) {
      return ACCEPTED_UPLOAD_TYPES;
    }

    return selectedUploadDocumentType.allowedExtensions.map((extension) => `.${extension}`).join(',');
  }, [selectedUploadDocumentType]);

  useEffect(() => {
    if (!selectedDoc) {
      setSelectedDoc(documents[0] || null);
      return;
    }

    const nextSelected = documents.find((document) => document.id === selectedDoc.id) || null;
    setSelectedDoc(nextSelected || documents[0] || null);
  }, [documents, selectedDoc?.id]);

  useEffect(() => {
    if (!uploadMatterId && matters.length > 0) {
      setUploadMatterId(matters[0].id);
    }
  }, [matters, uploadMatterId]);

  useEffect(() => {
    if (!uploadCategoryCode && activeDocumentTypes.length > 0) {
      setUploadCategoryCode(activeDocumentTypes[0].code);
      return;
    }

    if (
      uploadCategoryCode &&
      activeDocumentTypes.length > 0 &&
      !activeDocumentTypes.some((documentType) => documentType.code === uploadCategoryCode)
    ) {
      setUploadCategoryCode(activeDocumentTypes[0].code);
    }
  }, [activeDocumentTypes, uploadCategoryCode]);

  useEffect(() => {
    if (!selectedUploadDocumentType) {
      return;
    }

    setUploadVisibility(selectedUploadDocumentType.clientVisibleDefault ? 'client' : 'internal');
    setUploadReviewState('unreviewed');
  }, [
    selectedUploadDocumentType?.clientVisibleDefault,
    selectedUploadDocumentType?.code,
  ]);

  useEffect(() => {
    if (!selectedDoc || !onFetchDocumentDetail) {
      setDocumentDetail(null);
      setDetailError(null);
      setIsLoadingDetail(false);
      return;
    }

    let cancelled = false;
    setIsLoadingDetail(true);
    setDetailError(null);

    void onFetchDocumentDetail(selectedDoc.id)
      .then((detail) => {
        if (!cancelled) {
          setDocumentDetail(detail);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDocumentDetail(null);
          setDetailError(error instanceof Error ? error.message : 'Document detail could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingDetail(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailReloadKey, onFetchDocumentDetail, selectedDoc?.id]);

  const filteredDocs = useMemo(() => {
    let result = documents;
    const search = localSearch || globalSearch;

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (document) =>
          document.name.toLowerCase().includes(s) ||
          document.matterTitle.toLowerCase().includes(s) ||
          document.clientName.toLowerCase().includes(s)
      );
    }

    if (visibilityFilter !== 'all') {
      result = result.filter((document) => document.visibility === visibilityFilter);
    }

    if (reviewFilter !== 'all') {
      result = result.filter((document) => document.reviewState === reviewFilter);
    }

    return result;
  }, [documents, globalSearch, localSearch, reviewFilter, visibilityFilter]);

  const groupedDocs = useMemo(() => {
    if (groupBy === 'none') return { 'All Documents': filteredDocs };

    return filteredDocs.reduce<Record<string, PlatformDocument[]>>((acc, doc) => {
      let key = 'Other';
      if (groupBy === 'matter') key = doc.matterTitle || 'No Matter';
      if (groupBy === 'client') key = doc.clientName || 'No Client';
      if (groupBy === 'category') key = doc.docCategory || 'Uncategorized';
      if (groupBy === 'visibility') key = doc.visibility === 'client' ? 'Client Visible' : 'Internal Only';
      if (groupBy === 'uploadDate') {
        const d = new Date(doc.uploadedAt);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - d.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 7) key = 'Last 7 Days';
        else if (diffDays <= 30) key = 'Last 30 Days';
        else key = 'Older';
      }

      if (!acc[key]) acc[key] = [];
      acc[key].push(doc);
      return acc;
    }, {});
  }, [filteredDocs, groupBy]);

  const openDocumentUrl = (url?: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  };

  const handleUploadSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onUploadDocument) {
      return;
    }

    if (!uploadMatterId || !uploadFile) {
      setActionError('Choose a matter and a document before uploading.');
      return;
    }

    setIsUploading(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await onUploadDocument({
        categoryCode: uploadCategoryCode || selectedUploadDocumentType?.code,
        file: uploadFile,
        matterId: uploadMatterId,
        reviewState: uploadReviewState,
        visibility: uploadVisibility,
      });
      setActionMessage('Document uploaded.');
      setUploadFile(null);
      setShowUploadForm(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Document upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleControlsUpdate = async (
    payload: { reviewState: 'reviewed' | 'unreviewed'; visibility: 'client' | 'internal' }
  ) => {
    if (!selectedDoc || !onUpdateDocument) {
      return;
    }

    setIsUpdatingControls(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await onUpdateDocument(selectedDoc.id, payload);
      setActionMessage('Document controls updated.');
      setDetailReloadKey((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Document controls could not be updated.');
    } finally {
      setIsUpdatingControls(false);
    }
  };

  const handleVersionUpload = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedDoc || !versionFile || !onUploadVersion) {
      return;
    }

    setIsUploadingVersion(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await onUploadVersion(selectedDoc.id, {
        file: versionFile,
        reviewState: versionReviewState,
      });
      setVersionFile(null);
      setActionMessage('New document version uploaded.');
      setDetailReloadKey((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Document version upload failed.');
    } finally {
      setIsUploadingVersion(false);
    }
  };

  const handleRescan = async () => {
    if (!selectedDoc || !onRescanDocument) {
      return;
    }

    setIsRescanning(true);
    setActionError(null);
    setActionMessage(null);

    try {
      await onRescanDocument(selectedDoc.id);
      setActionMessage('Document scan completed.');
      setDetailReloadKey((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Document scan could not be completed.');
    } finally {
      setIsRescanning(false);
    }
  };

  const selectedScanStatus = selectedDoc ? getScanStatus(selectedDoc, documentDetail) : 'unscanned';
  const selectedScanMeta = scanStatusMeta(selectedScanStatus);
  const selectedCanPreview =
    selectedDoc && canPreviewDocument(selectedDoc, documentDetail) && canPreviewByScanStatus(selectedScanStatus);
  const selectedCanDownload = selectedDoc && canDownloadByScanStatus(selectedScanStatus);

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col -m-6 p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>
            Documents Center
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage files, adjust visibility, and review uploads.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            disabled={!onUploadDocument || matters.length === 0}
            onClick={() => setShowUploadForm((value) => !value)}
            type="button"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>

      {showUploadForm && (
        <form
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          onSubmit={(event) => void handleUploadSubmit(event)}
        >
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] lg:items-end">
            <label className="text-xs font-medium text-gray-500">
              Matter
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
                onChange={(event) => setUploadMatterId(event.target.value)}
                value={uploadMatterId}
              >
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.referenceCode} - {matter.title} ({matter.clientName})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-gray-500">
              Document Type
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
                onChange={(event) => setUploadCategoryCode(event.target.value)}
                value={uploadCategoryCode}
              >
                {activeDocumentTypes.map((documentType) => (
                  <option key={documentType.id} value={documentType.code}>
                    {documentType.name}
                  </option>
                ))}
                {activeDocumentTypes.length === 0 ? <option value="">Default attachment</option> : null}
              </select>
            </label>
            <label className="text-xs font-medium text-gray-500">
              Visibility
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
                onChange={(event) => setUploadVisibility(event.target.value as 'client' | 'internal')}
                value={uploadVisibility}
              >
                <option value="internal">Internal Only</option>
                <option value="client">Client Visible</option>
              </select>
            </label>
            <label className="text-xs font-medium text-gray-500">
              Scan Status
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 outline-none"
                disabled
                value={uploadReviewState}
              >
                <option value="unreviewed">Scanned automatically after upload</option>
              </select>
              <span className="mt-1 block text-[11px] text-gray-400">
                Review and preview availability are set by the malware scan result.
              </span>
            </label>
            <label className="text-xs font-medium text-gray-500">
              File
              <input
                accept={acceptedUploadTypes}
                className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:text-gray-700"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                type="file"
              />
              {selectedUploadDocumentType ? (
                <span className="mt-1 block text-[11px] text-gray-400">
                  Up to {selectedUploadDocumentType.maxSizeMb} MB · {selectedUploadDocumentType.allowedExtensions.join(', ')}
                </span>
              ) : null}
            </label>
            <button
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200"
              disabled={isUploading || !uploadFile || !uploadMatterId}
              type="submit"
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      )}

      {(actionMessage || actionError) && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            actionError
              ? 'border-red-100 bg-red-50 text-red-700'
              : 'border-emerald-100 bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionError ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
          {actionError || actionMessage}
        </div>
      )}

      <div className="grid min-h-0 min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4 bg-gray-50/50">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400 bg-white"
                onChange={(event) => setLocalSearch(event.target.value)}
                placeholder="Search documents..."
                type="text"
                value={localSearch}
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none bg-white min-w-[120px]"
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                value={groupBy}
              >
                <option value="none">No Grouping</option>
                <option value="matter">Group by Matter</option>
                <option value="client">Group by Client</option>
                <option value="category">Group by Category</option>
                <option value="visibility">Group by Visibility</option>
                <option value="uploadDate">Group by Upload Date</option>
              </select>

              <select
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none bg-white min-w-[120px]"
                onChange={(event) => setVisibilityFilter(event.target.value as 'all' | 'client' | 'internal')}
                value={visibilityFilter}
              >
                <option value="all">All Visibility</option>
                <option value="client">Client Visible</option>
                <option value="internal">Internal Only</option>
              </select>

              <select
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none bg-white min-w-[120px]"
                onChange={(event) => setReviewFilter(event.target.value as 'all' | 'reviewed' | 'unreviewed')}
                value={reviewFilter}
              >
                <option value="all">All Review</option>
                <option value="reviewed">Reviewed</option>
                <option value="unreviewed">Needs Review</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {Object.entries(groupedDocs).map(([groupName, docs]) => (
              <div key={groupName} className="mb-6 last:mb-0">
                {groupBy !== 'none' && (
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                    <ChevronDown className="w-3.5 h-3.5" />
                    {groupName}
                    <span className="bg-gray-100 text-gray-500 px-1.5 rounded-full">{docs.length}</span>
                  </h3>
                )}
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div
                      className={`flex items-center gap-4 p-3 rounded-xl border transition cursor-pointer group ${
                        selectedDoc?.id === doc.id
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-white border-gray-100 hover:border-gray-300 hover:shadow-sm'
                      }`}
                      key={doc.id}
                      onClick={() => setSelectedDoc(doc)}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                        {getFileIcon(doc.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p
                            className={`font-medium truncate ${
                              selectedDoc?.id === doc.id ? 'text-blue-900' : 'text-gray-900'
                            }`}
                          >
                            {doc.name}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            {doc.visibility === 'client' ? (
                              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                <Eye className="w-3 h-3" /> Client
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                <EyeOff className="w-3 h-3" /> Internal
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          {doc.matterTitle && (
                            <span className="truncate max-w-[150px]" title={doc.matterTitle}>
                              {doc.matterTitle}
                            </span>
                          )}
                          {doc.matterTitle && <span className="text-gray-300">•</span>}
                          <span>{formatDate(doc.uploadedAt)}</span>
                          <span className="text-gray-300">•</span>
                          <span>{formatSize(doc.size)}</span>
                          <span className="text-gray-300">•</span>
                          {doc.reviewState === 'reviewed' ? (
                            <span className="flex items-center gap-1 text-emerald-600">
                              <CheckCircle className="w-3 h-3" /> Reviewed
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-600">
                              <Clock className="w-3 h-3" /> Needs Review
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${scanStatusMeta(doc.virusStatus || 'unscanned').tone}`}>
                            {scanStatusMeta(doc.virusStatus || 'unscanned').label}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {filteredDocs.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  action={{
                    label: 'Clear Filters',
                    onClick: () => {
                      setLocalSearch('');
                      setVisibilityFilter('all');
                      setReviewFilter('all');
                    },
                  }}
                  description="Try adjusting your search query, or clear your filters to see more results."
                  icon={Search}
                  title="No documents found"
                />
              </div>
            )}
          </div>
        </div>

        {selectedDoc ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden h-full">
            <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0">
                  {getFileIcon(selectedDoc.type, 'w-6 h-6')}
                </div>
                <div className="min-w-0">
                  <h2 className="font-medium text-gray-900 leading-tight break-words">{selectedDoc.name}</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Uploaded by <span className="font-medium text-gray-700">{selectedDoc.uploadedBy}</span> on{' '}
                    {formatDate(selectedDoc.uploadedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!buildDownloadUrl || !selectedCanDownload}
                  onClick={() => openDocumentUrl(buildDownloadUrl?.(selectedDoc.id))}
                  title={selectedCanDownload ? 'Download document' : 'Download blocked by malware scan policy'}
                  type="button"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!buildPreviewUrl || !selectedCanPreview}
                  onClick={() => openDocumentUrl(buildPreviewUrl?.(selectedDoc.id))}
                  title={
                    selectedCanPreview
                      ? 'Preview document'
                      : 'Preview unavailable until this safe file type has a clean scan'
                  }
                  type="button"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Matter</p>
                  <p className="text-sm font-medium text-gray-900">{selectedDoc.matterTitle || 'Unassigned'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Client</p>
                  <p className="text-sm font-medium text-gray-900">{selectedDoc.clientName || 'Unassigned'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">File Size</p>
                  <p className="text-sm font-medium text-gray-900">{formatSize(selectedDoc.size)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Category</p>
                  <p className="text-sm font-medium text-gray-900">{selectedDoc.docCategory}</p>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">Malware Scan</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {documentDetail?.latestVersion?.scanProvider
                        ? `Provider: ${documentDetail.latestVersion.scanProvider}`
                        : 'Provider: not configured'}
                      {documentDetail?.latestVersion?.scanCheckedAt
                        ? ` · Checked ${formatDate(documentDetail.latestVersion.scanCheckedAt)}`
                        : ''}
                    </p>
                    {documentDetail?.latestVersion?.scanError ? (
                      <p className="mt-1 text-xs text-red-600">{documentDetail.latestVersion.scanError}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${selectedScanMeta.tone}`}>
                      {selectedScanMeta.label}
                    </span>
                    <button
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!onRescanDocument || isRescanning}
                      onClick={() => void handleRescan()}
                      type="button"
                    >
                      {isRescanning ? 'Scanning...' : 'Rescan'}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">Client Visibility</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Can the client see this document?</p>
                  </div>
                  <button
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      selectedDoc.visibility === 'client' ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                    disabled={isUpdatingControls || !onUpdateDocument}
                    onClick={() => {
                      const nextVisibility = selectedDoc.visibility === 'client' ? 'internal' : 'client';
                      void handleControlsUpdate({
                        reviewState: selectedDoc.reviewState === 'reviewed' ? 'reviewed' : 'unreviewed',
                        visibility: nextVisibility,
                      });
                    }}
                    type="button"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        selectedDoc.visibility === 'client' ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">Review Status</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Review follows scan status; only clean scans appear reviewed.</p>
                  </div>
                  <select
                    className="text-sm border border-gray-300 rounded-md px-2 py-1 outline-none font-medium bg-white disabled:cursor-not-allowed disabled:bg-gray-100"
                    disabled
                    value={selectedDoc.reviewState}
                  >
                    <option value="unreviewed">Needs Review</option>
                    <option value="reviewed">Reviewed</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Version History</h3>
                  {isLoadingDetail && <span className="text-xs text-gray-400">Loading...</span>}
                </div>
                {detailError && (
                  <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {detailError}
                  </div>
                )}
                <form className="mb-4 space-y-2 rounded-lg border border-gray-100 bg-gray-50/70 p-3" onSubmit={(event) => void handleVersionUpload(event)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      accept={ACCEPTED_UPLOAD_TYPES}
                      className="min-w-0 flex-1 text-xs text-gray-700 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-2 file:py-1.5 file:text-xs file:text-gray-700"
                      onChange={(event) => setVersionFile(event.target.files?.[0] || null)}
                      type="file"
                    />
                    <select
                      className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-500"
                      disabled
                      value={versionReviewState}
                    >
                      <option value="unreviewed">Scanned after upload</option>
                    </select>
                    <button
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-200"
                      disabled={!versionFile || isUploadingVersion || !onUploadVersion}
                      type="submit"
                    >
                      {isUploadingVersion ? 'Uploading...' : 'Add Version'}
                    </button>
                  </div>
                </form>

                <div className="space-y-3">
                  {(documentDetail?.versions || []).map((version) => (
                    <div className={version.isCurrent ? 'flex items-start gap-3' : 'flex items-start gap-3 opacity-70'} key={version.id}>
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                          version.isCurrent ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        v{version.versionNo}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {version.isCurrent ? 'Current Version' : version.originalFileName}
                        </p>
                        <p className="text-xs text-gray-500">
                          Uploaded {formatDate(version.uploadedAt)} by {version.uploadedBy} -{' '}
                          {formatSize(version.fileSizeBytes)} - {scanStatusMeta(version.virusStatus).label}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!isLoadingDetail && documentDetail?.versions.length === 0 && (
                    <p className="text-sm text-gray-400 italic">No version records were found.</p>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Internal Notes</h3>
                  <span className="text-xs text-gray-400">Read-only here</span>
                </div>
                {selectedDoc.note ? (
                  <div className="bg-amber-50 border border-amber-100 text-sm text-gray-700 p-3 rounded-lg">
                    {selectedDoc.note}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No internal notes for this document.</p>
                )}
              </div>
            </div>

            <div className="m-4 rounded-xl border border-gray-200 bg-gray-50 p-4 shrink-0">
              <div className="flex items-center gap-3">
                {getFileIcon(selectedDoc.type, 'w-6 h-6')}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {selectedCanPreview
                      ? 'Safe preview is available'
                      : 'Preview unavailable'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Unsafe file types and files without a clean scan are never rendered inline.
                  </p>
                </div>
                <button
                  className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                  disabled={!buildPreviewUrl || !selectedCanPreview}
                  onClick={() => openDocumentUrl(buildPreviewUrl?.(selectedDoc.id))}
                  type="button"
                >
                  Open Preview
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col items-center justify-center p-8 h-full text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
              <File className="w-8 h-8 text-gray-300" />
            </div>
            <h3 className="text-lg font-medium text-gray-900">No Document Selected</h3>
            <p className="text-sm text-gray-500 max-w-xs mt-1">
              Select a document from the list to view its details, manage visibility, and access preview.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
