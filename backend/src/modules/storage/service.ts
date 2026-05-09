import { createHash } from 'node:crypto';
import path from 'node:path';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { nowUtc, toMysqlDateTime } from '../../lib/datetime.js';
import { createPublicId } from '../../lib/ids.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from '../../lib/httpErrors.js';
import { getMysqlPool } from '../../lib/mysql.js';
import { selectOne, withTransaction } from '../../lib/mysqlUtils.js';
import { getRequestContext, logEvent } from '../../lib/observability.js';
import { allocateBusinessNumber } from '../platform/sequences.js';
import { LocalDocumentStorage } from './localDocumentStorage.js';
import {
  getInitialDocumentScanResult,
  isScanBlocked,
  scanDocumentContent,
  shouldRunBackgroundScan,
  type DocumentScanResult,
} from './malwareScanner.js';
import { MysqlStoredUploadRepository } from './mysqlStoredUploadRepository.js';
import { S3DocumentStorage } from './s3DocumentStorage.js';
import type {
  CreateStoredUploadInput,
  StoredUploadRecord,
  StoredUploadRepository,
} from './types.js';

interface ClientDocumentDownloadRow extends RowDataPacket {
  document_id: number;
  document_version_id: number;
  mime_type: string;
  original_file_name: string;
  storage_path: string;
  virus_scan_status_code: string;
}

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;
const MIME_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const CLIENT_VISIBLE_SCOPES = ['client', 'client-portal', 'shared'];
const SAFE_PREVIEW_MIME_TYPES = new Set([
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain',
]);
const UPLOAD_ALLOWED_MIME_TYPES = new Set([
  ...SAFE_PREVIEW_MIME_TYPES,
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
]);
const UPLOAD_ALLOWED_EXTENSIONS = new Set([
  'csv',
  'doc',
  'docx',
  'gif',
  'jpg',
  'jpeg',
  'pdf',
  'png',
  'txt',
  'webp',
  'xls',
  'xlsx',
  'zip',
]);

const isMysqlConfigured = Boolean(
  env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER && env.MYSQL_PASSWORD
);

const resolveDocumentRoot = () =>
  path.isAbsolute(env.DOCUMENT_STORAGE_ROOT)
    ? env.DOCUMENT_STORAGE_ROOT
    : path.resolve(process.cwd(), env.DOCUMENT_STORAGE_ROOT);

const createStorageDriver = () => {
  if (env.DOCUMENT_STORAGE_DRIVER === 's3') {
    return new S3DocumentStorage({
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      bucket: env.S3_BUCKET || '',
      endpoint: env.S3_ENDPOINT || '',
      region: env.S3_REGION,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
      sessionToken: env.S3_SESSION_TOKEN || null,
      verifyUploadSha256: env.S3_VERIFY_UPLOAD_SHA256,
    });
  }

  return new LocalDocumentStorage(resolveDocumentRoot());
};

const storageDriver = createStorageDriver();

let repositoryPromise: Promise<StoredUploadRepository | null> | null = null;
let initializationPromise: Promise<void> | null = null;

const serializeError = (error: unknown) =>
  error instanceof Error
    ? {
        message: error.message,
        name: error.name,
        stack: error.stack,
      }
    : error;

const truncate = (value: string, maxLength = 500) =>
  value.length > maxLength ? value.slice(0, maxLength - 1) : value;

const toScanFailureResult = (error: unknown): DocumentScanResult => ({
  errorText: error instanceof Error ? truncate(error.message) : 'Scanner request failed.',
  providerCode: env.FILE_SCAN_MODE === 'clamav' ? 'clamav' : 'disabled',
  status: 'scan_failed',
});

const scanActionCode = (status: string) => {
  if (status === 'clean') return 'document.scan_clean';
  if (status === 'infected') return 'document.scan_infected';
  if (status === 'scan_failed') return 'document.scan_failed';
  if (status === 'scan_skipped_manual_mode') return 'document.scan_skipped';
  return 'document.scan_requested';
};

const getRepository = async () => {
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      if (!isMysqlConfigured) {
        return null;
      }

      const repository = new MysqlStoredUploadRepository(getMysqlPool());
      await repository.initialize();
      return repository;
    })().catch((error) => {
      repositoryPromise = null;
      throw error;
    });
  }

  return repositoryPromise;
};

const ensureStorageReady = async () => {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      if (env.DOCUMENT_STORAGE_DRIVER === 'disabled') {
        return;
      }

      await storageDriver.ensureReady();
      await getRepository();
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  await initializationPromise;
};

const requireRepository = async () => {
  const repository = await getRepository();

  if (!repository) {
    throw serviceUnavailable(
      'document_storage_unavailable',
      'Document storage requires a configured MySQL connection.'
    );
  }

  return repository;
};

const requireUploadEnabled = async () => {
  if (env.DOCUMENT_STORAGE_DRIVER === 'disabled') {
    throw serviceUnavailable(
      'document_storage_disabled',
      'Document storage is not available right now.'
    );
  }

  await ensureStorageReady();
};

const normalizeMimeType = (mimeType: string) => mimeType.trim().toLowerCase();

const validateIntentInput = (input: CreateStoredUploadInput) => {
  if (input.sizeBytes <= 0 || input.sizeBytes > env.DOCUMENT_UPLOAD_MAX_BYTES) {
    throw badRequest(
      'upload_size_invalid',
      `Uploads must be between 1 byte and ${env.DOCUMENT_UPLOAD_MAX_BYTES} bytes.`
    );
  }

  if (!CHECKSUM_PATTERN.test(input.checksumSha256)) {
    throw badRequest(
      'upload_checksum_invalid',
      'checksumSha256 must be a valid 64-character SHA-256 hex digest.'
    );
  }

  if (!MIME_TYPE_PATTERN.test(normalizeMimeType(input.mimeType))) {
    throw badRequest('upload_mime_invalid', 'mimeType must be a valid MIME type.');
  }

  assertSupportedUploadType(input);
};

const buildRecord = (id: string, input: CreateStoredUploadInput): StoredUploadRecord => ({
  checksumSha256: input.checksumSha256.toLowerCase(),
  createdAt: nowUtc(),
  id,
  mimeType: normalizeMimeType(input.mimeType),
  originalName: input.originalName.trim(),
  ownerAccountId: input.ownerAccountId,
  relatedEntityId: input.relatedEntityId,
  relatedEntityType: input.relatedEntityType,
  sizeBytes: input.sizeBytes,
  sourceModule: input.sourceModule.trim(),
  status: 'pending',
  storageDriver: input.storageDriver,
  storageKey: input.storageKey,
});

const computeSha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

const toFileExtension = (fileName: string) => {
  const extension = path.extname(fileName).replace('.', '').trim().toLowerCase();
  return extension || 'bin';
};

const assertSupportedUploadType = (
  input: Pick<CreateStoredUploadInput, 'mimeType' | 'originalName'>
) => {
  const mimeType = normalizeMimeType(input.mimeType);
  const extension = toFileExtension(input.originalName);

  if (!UPLOAD_ALLOWED_MIME_TYPES.has(mimeType) || !UPLOAD_ALLOWED_EXTENSIONS.has(extension)) {
    throw badRequest(
      'upload_type_not_allowed',
      'This file type is not supported for secure document upload.'
    );
  }
};

const isSafePreviewMimeType = (mimeType: string) =>
  SAFE_PREVIEW_MIME_TYPES.has(normalizeMimeType(mimeType));

const insertDocumentAuditEvent = async (
  connection: PoolConnection,
  input: {
    actionCode: string;
    actionLabel: string;
    actorRoleCode: string;
    actorUserId: number;
    entityPk: number;
    sourceModule: string;
    summaryNewValue?: string | null;
  }
) => {
  const requestContext = getRequestContext();
  await connection.execute(
    `INSERT INTO audit_events (
       public_id,
       actor_user_id,
       actor_role_code_snapshot,
       entity_table_name,
       entity_pk,
       action_code,
       action_label,
       source_module,
       request_correlation_id,
       ip_address,
       user_agent,
       summary_old_value,
       summary_new_value,
       occurred_at
     ) VALUES (?, ?, ?, 'documents', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      createPublicId(),
      input.actorUserId,
      input.actorRoleCode,
      input.entityPk,
      input.actionCode,
      input.actionLabel,
      input.sourceModule,
      requestContext?.requestId ?? null,
      requestContext?.ipAddress ?? null,
      requestContext?.userAgent ?? null,
      input.summaryNewValue || null,
      toMysqlDateTime(nowUtc()),
    ]
  );
};

const updateDocumentVersionScanResult = async (input: {
  actorRoleCode: string;
  actorUserId: number;
  documentId: number;
  documentVersionId: number;
  result: DocumentScanResult;
  sourceModule: string;
}) => {
  await withTransaction(getMysqlPool(), async (connection) => {
    await connection.execute(
      `UPDATE document_versions
       SET virus_scan_status_code = ?,
           scan_provider_code = ?,
           scan_checked_at = ?,
           scan_error_text = ?,
           quarantine_flag = ?
       WHERE id = ?
         AND virus_scan_status_code = 'pending_scan'`,
      [
        input.result.status,
        input.result.providerCode,
        toMysqlDateTime(nowUtc()),
        input.result.errorText,
        input.result.status === 'infected' ? 1 : 0,
        input.documentVersionId,
      ]
    );

    await insertDocumentAuditEvent(connection, {
      actionCode: scanActionCode(input.result.status),
      actionLabel: `Document scan ${input.result.status.replace(/_/g, ' ')}`,
      actorRoleCode: input.actorRoleCode,
      actorUserId: input.actorUserId,
      entityPk: input.documentId,
      sourceModule: input.sourceModule,
      summaryNewValue: `${input.result.providerCode}: ${input.result.status}`,
    });
  });
};

const runClientDocumentBackgroundScan = async (input: {
  actorUserId: number;
  documentId: number;
  documentVersionId: number;
  sourceModule: string;
  storageKey: string;
}) => {
  let scanResult: DocumentScanResult;

  try {
    const content = await storageDriver.readBuffer(input.storageKey);
    scanResult = await scanDocumentContent(content);
  } catch (error) {
    scanResult = toScanFailureResult(error);
    logEvent('error', 'document.background_scan_failed', {
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      error: serializeError(error),
    });
  }

  try {
    await updateDocumentVersionScanResult({
      actorRoleCode: 'client',
      actorUserId: input.actorUserId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      result: scanResult,
      sourceModule: input.sourceModule,
    });
  } catch (error) {
    logEvent('error', 'document.background_scan_update_failed', {
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      error: serializeError(error),
    });
  }
};

const scheduleClientDocumentBackgroundScan = (input: {
  actorUserId: number;
  documentId: number;
  documentVersionId: number;
  sourceModule: string;
  storageKey: string;
}) => {
  void runClientDocumentBackgroundScan(input).catch((error) => {
    logEvent('error', 'document.background_scan_unhandled_error', {
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      error: serializeError(error),
    });
  });
};

const resolveOwnerContext = async (connection: PoolConnection, ownerPublicId: string) =>
  selectOne<RowDataPacket>(
    connection,
    `SELECT
       u.id AS user_id,
       ca.id AS client_account_id
     FROM users u
     INNER JOIN client_account_contacts cac
       ON cac.user_id = u.id
       AND cac.portal_access_enabled = 1
       AND cac.archived_at IS NULL
     INNER JOIN client_accounts ca
       ON ca.id = cac.client_account_id
       AND ca.archived_at IS NULL
     WHERE u.public_id = ?
     LIMIT 1`,
    [ownerPublicId]
  );

const linkStoredDocument = async (
  connection: PoolConnection,
  input: {
    documentId: number;
    ownerClientAccountId: number;
    relatedEntityId?: string;
    relatedEntityType?: string;
  }
) => {
  if (!input.relatedEntityId || !input.relatedEntityType) {
    return;
  }

  const createdAt = toMysqlDateTime(nowUtc());

  if (input.relatedEntityType === 'request') {
    const requestRow = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM service_requests WHERE public_id = ? AND client_account_id = ? LIMIT 1',
      [input.relatedEntityId, input.ownerClientAccountId]
    );

    if (requestRow?.id) {
      await connection.execute(
        `INSERT INTO request_documents (
          service_request_id, document_id, link_role_code, created_at
        ) VALUES (?, ?, ?, ?)`,
        [Number(requestRow.id), input.documentId, 'attachment', createdAt]
      );
      return;
    }

    throw forbidden('upload_relation_forbidden', 'The selected request is not available for this upload.');
  }

  if (input.relatedEntityType === 'matter') {
    const matterRow = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM matters WHERE public_id = ? AND client_account_id = ? AND archived_at IS NULL LIMIT 1',
      [input.relatedEntityId, input.ownerClientAccountId]
    );

    if (matterRow?.id) {
      await connection.execute(
        `INSERT INTO matter_documents (
          matter_id, document_id, link_role_code, created_at
        ) VALUES (?, ?, ?, ?)`,
        [Number(matterRow.id), input.documentId, 'attachment', createdAt]
      );
      return;
    }

    throw forbidden('upload_relation_forbidden', 'The selected matter is not available for this upload.');
  }

  if (input.relatedEntityType === 'invoice') {
    const invoiceRow = await selectOne<RowDataPacket>(
      connection,
      'SELECT id FROM invoices WHERE public_id = ? AND client_account_id = ? AND archived_at IS NULL LIMIT 1',
      [input.relatedEntityId, input.ownerClientAccountId]
    );

    if (invoiceRow?.id) {
      await connection.execute(
        `INSERT INTO invoice_documents (
          invoice_id, document_id, link_role_code, created_at
        ) VALUES (?, ?, ?, ?)`,
        [Number(invoiceRow.id), input.documentId, 'attachment', createdAt]
      );
      return;
    }

    throw forbidden('upload_relation_forbidden', 'The selected invoice is not available for this upload.');
  }
};

export const documentStorageService = {
  async initialize() {
    await requireUploadEnabled();
  },

  async createUploadIntent(
    ownerAccountId: string,
    input: Omit<CreateStoredUploadInput, 'ownerAccountId' | 'storageDriver' | 'storageKey'>
  ) {
    await requireUploadEnabled();

    const uploadId = createPublicId();
    const storageKey = storageDriver.buildStorageKey(ownerAccountId, uploadId, input.originalName);
    const repository = await requireRepository();
    const record = buildRecord(uploadId, {
      ...input,
      ownerAccountId,
      storageDriver: storageDriver.driverCode,
      storageKey,
    });

    validateIntentInput(record);
    await repository.save(record);

    return {
      maxSizeBytes: env.DOCUMENT_UPLOAD_MAX_BYTES,
      upload: record,
      uploadId: record.id,
      uploadUrl: `/api/v1/uploads/${record.id}/content`,
    };
  },

  async storeUploadContent(ownerAccountId: string, uploadId: string, content: Buffer) {
    await requireUploadEnabled();
    const repository = await requireRepository();
    const record = await repository.getById(uploadId);

    if (!record) {
      throw notFound('upload_not_found', 'Upload record not found.');
    }

    if (record.ownerAccountId !== ownerAccountId) {
      throw forbidden('upload_forbidden', 'You do not have access to this upload.');
    }

    if (record.status !== 'pending') {
      throw conflict('upload_already_completed', 'This upload has already been completed.');
    }

    if (content.length !== record.sizeBytes) {
      throw badRequest(
        'upload_size_mismatch',
        'Uploaded file size does not match the declared size.'
      );
    }

    const checksum = computeSha256(content);

    if (checksum !== record.checksumSha256) {
      throw badRequest(
        'upload_checksum_mismatch',
        'Uploaded file checksum does not match the declared checksum.'
      );
    }

    await storageDriver.writeBuffer(record.storageKey, content);
    const initialScanResult = getInitialDocumentScanResult();

    const finalizedAt = nowUtc();

    const backgroundScan = await withTransaction(getMysqlPool(), async (connection) => {
      const ownerContext = await resolveOwnerContext(connection, ownerAccountId);

      if (!ownerContext?.user_id || !ownerContext?.client_account_id) {
        throw notFound('upload_owner_not_found', 'Upload owner could not be resolved.');
      }

      const documentNumber = await allocateBusinessNumber(connection, 'document', 'DOC');
      const [documentInsert] = await connection.execute(
        `INSERT INTO documents (
          public_id, document_number, owner_client_account_id, title, category_code,
          visibility_scope_code, current_version_no, created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createPublicId(),
          documentNumber,
          Number(ownerContext.client_account_id),
          record.originalName,
          'attachment',
          'client',
          1,
          Number(ownerContext.user_id),
          toMysqlDateTime(record.createdAt),
          toMysqlDateTime(finalizedAt),
        ]
      );
      const documentId = Number((documentInsert as { insertId: number }).insertId);

      const [versionInsert] = await connection.execute(
        `INSERT INTO document_versions (
          public_id, document_id, version_no, storage_driver_code, storage_path, original_file_name,
          mime_type, file_extension, file_size_bytes, checksum_sha256, virus_scan_status_code,
          scan_provider_code, scan_checked_at, scan_error_text, quarantine_flag,
          uploaded_by_user_id, uploaded_at, is_current, retention_hold_flag
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createPublicId(),
          documentId,
          1,
          record.storageDriver,
          record.storageKey,
          record.originalName,
          record.mimeType,
          toFileExtension(record.originalName),
          record.sizeBytes,
          record.checksumSha256,
          initialScanResult.status,
          initialScanResult.providerCode,
          initialScanResult.status === 'pending_scan' ? null : toMysqlDateTime(finalizedAt),
          initialScanResult.errorText,
          initialScanResult.status === 'infected' ? 1 : 0,
          Number(ownerContext.user_id),
          toMysqlDateTime(finalizedAt),
          1,
          0,
        ]
      );
      const documentVersionId = Number((versionInsert as { insertId: number }).insertId);

      await linkStoredDocument(connection, {
        documentId,
        ownerClientAccountId: Number(ownerContext.client_account_id),
        relatedEntityId: record.relatedEntityId,
        relatedEntityType: record.relatedEntityType,
      });

      await connection.execute(
        `UPDATE document_upload_intents
         SET status_code = ?, document_id = ?, document_version_id = ?, stored_at = ?
         WHERE public_id = ?`,
        ['stored', documentId, documentVersionId, toMysqlDateTime(finalizedAt), record.id]
      );

      await insertDocumentAuditEvent(connection, {
        actionCode: 'document.uploaded',
        actionLabel: 'Document uploaded',
        actorRoleCode: 'client',
        actorUserId: Number(ownerContext.user_id),
        entityPk: documentId,
        sourceModule: record.sourceModule,
        summaryNewValue: `${documentNumber}: ${record.originalName}`,
      });

      await insertDocumentAuditEvent(connection, {
        actionCode: 'document.scan_requested',
        actionLabel: 'Document malware scan requested',
        actorRoleCode: 'client',
        actorUserId: Number(ownerContext.user_id),
        entityPk: documentId,
        sourceModule: record.sourceModule,
        summaryNewValue: record.originalName,
      });

      if (!shouldRunBackgroundScan(initialScanResult)) {
        await insertDocumentAuditEvent(connection, {
          actionCode: scanActionCode(initialScanResult.status),
          actionLabel: `Document scan ${initialScanResult.status.replace(/_/g, ' ')}`,
          actorRoleCode: 'client',
          actorUserId: Number(ownerContext.user_id),
          entityPk: documentId,
          sourceModule: record.sourceModule,
          summaryNewValue: `${initialScanResult.providerCode}: ${initialScanResult.status}`,
        });
        return null;
      }

      return {
        actorUserId: Number(ownerContext.user_id),
        documentId,
        documentVersionId,
        sourceModule: record.sourceModule,
        storageKey: record.storageKey,
      };
    });

    const updatedRecord: StoredUploadRecord = {
      ...record,
      finalizedAt,
      status: 'stored',
    };

    await repository.save(updatedRecord);

    logEvent('info', 'document.upload_stored', {
      ownerAccountId,
      sizeBytes: updatedRecord.sizeBytes,
      storageKey: updatedRecord.storageKey,
      uploadId: updatedRecord.id,
    });

    if (backgroundScan) {
      scheduleClientDocumentBackgroundScan(backgroundScan);
    }

    return updatedRecord;
  },

  async getDownloadFile(ownerAccountId: string, uploadId: string) {
    await requireUploadEnabled();
    const repository = await requireRepository();
    const record = await repository.getById(uploadId);

    if (!record) {
      throw notFound('upload_not_found', 'Upload record not found.');
    }

    if (record.ownerAccountId !== ownerAccountId) {
      throw forbidden('upload_forbidden', 'You do not have access to this upload.');
    }

    if (record.status !== 'stored' && record.status !== 'attached') {
      throw conflict('upload_not_ready', 'The requested upload is not ready for download.');
    }

    return {
      content: await storageDriver.readBuffer(record.storageKey),
      upload: record,
    };
  },

  async getClientDocumentFile(
    userPublicId: string,
    clientAccountId: number,
    documentPublicId: string,
    options: {
      ipAddress?: string | null;
      mode: 'download' | 'preview';
      userAgent?: string | null;
    }
  ) {
    await requireUploadEnabled();

    return withTransaction(getMysqlPool(), async (connection) => {
      const userRow = await selectOne<RowDataPacket>(
        connection,
        'SELECT id FROM users WHERE public_id = ? LIMIT 1',
        [userPublicId]
      );

      if (!userRow?.id) {
        throw notFound('document_downloader_not_found', 'Current user could not be resolved.');
      }

      const documentRow = await selectOne<ClientDocumentDownloadRow>(
        connection,
        `SELECT
           d.id AS document_id,
           dv.id AS document_version_id,
           dv.storage_path,
           dv.mime_type,
           dv.original_file_name,
           dv.virus_scan_status_code
         FROM documents d
         INNER JOIN document_versions dv
           ON dv.document_id = d.id
           AND dv.is_current = 1
         WHERE d.public_id = ?
           AND d.owner_client_account_id = ?
           AND d.archived_at IS NULL
           AND d.visibility_scope_code IN (?, ?, ?)
         LIMIT 1`,
        [documentPublicId, clientAccountId, ...CLIENT_VISIBLE_SCOPES]
      );

      if (!documentRow?.document_id) {
        throw notFound('document_not_found', 'Document could not be found.');
      }

      if (isScanBlocked(documentRow.virus_scan_status_code, options.mode)) {
        throw forbidden(
          'document_not_available',
          options.mode === 'preview'
            ? 'Preview is unavailable until malware scanning allows it.'
            : 'Download is unavailable until malware scanning allows it.'
        );
      }

      if (options.mode === 'preview' && !isSafePreviewMimeType(documentRow.mime_type)) {
        throw badRequest(
          'document_preview_unavailable',
          'Preview is not available for this file type. Please download the file instead.'
        );
      }

      if (options.mode === 'download') {
        await connection.execute(
          `INSERT INTO document_download_logs (
            document_id, document_version_id, downloaded_by_user_id, ip_address, user_agent, downloaded_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            Number(documentRow.document_id),
            Number(documentRow.document_version_id),
            Number(userRow.id),
            options.ipAddress || null,
            options.userAgent || null,
            toMysqlDateTime(nowUtc()),
          ]
        );
      }

      await insertDocumentAuditEvent(connection, {
        actionCode: options.mode === 'preview' ? 'document.previewed' : 'document.downloaded',
        actionLabel: options.mode === 'preview' ? 'Document previewed' : 'Document downloaded',
        actorRoleCode: 'client',
        actorUserId: Number(userRow.id),
        entityPk: Number(documentRow.document_id),
        sourceModule: 'client_portal_documents',
        summaryNewValue: documentRow.original_file_name,
      });

      return {
        content: await storageDriver.readBuffer(documentRow.storage_path),
        mimeType: documentRow.mime_type,
        originalName: documentRow.original_file_name,
      };
    });
  },

  async getClientDocumentDownload(
    userPublicId: string,
    clientAccountId: number,
    documentPublicId: string,
    options: {
      ipAddress?: string | null;
      userAgent?: string | null;
    } = {}
  ) {
    return this.getClientDocumentFile(userPublicId, clientAccountId, documentPublicId, {
      ...options,
      mode: 'download',
    });
  },

  async getClientDocumentPreview(
    userPublicId: string,
    clientAccountId: number,
    documentPublicId: string,
    options: {
      ipAddress?: string | null;
      userAgent?: string | null;
    } = {}
  ) {
    return this.getClientDocumentFile(userPublicId, clientAccountId, documentPublicId, {
      ...options,
      mode: 'preview',
    });
  },

  async onStartup() {
    if (env.DOCUMENT_STORAGE_DRIVER === 'disabled') {
      return;
    }

    try {
      await ensureStorageReady();
    } catch (error) {
      logEvent('error', 'document.storage_initialization_failed', {
        error: serializeError(error),
        rootDirectory: resolveDocumentRoot(),
      });
      throw error;
    }
  },
};
