import {
  type CreateUploadIntentPayload,
  type CreateUploadIntentResponse,
  type StoreUploadContentResponse,
} from './contracts';
import {
  API_DOWNLOAD_TIMEOUT_MS,
  ApiRequestError,
  FORM_IDEMPOTENCY_TTL_MS,
  apiRequest,
  createIdempotencyIdentity,
} from './client';
import { API_ENDPOINTS } from './endpoints';

interface UploadFilesOptions {
  relatedEntityId?: string;
  relatedEntityType?: 'invoice' | 'matter' | 'request' | 'thread';
  sourceModule: string;
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

const requireSubtleCrypto = () => {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new ApiRequestError(
      'secure_context_required',
      'Secure browser context is required for document uploads.'
    );
  }

  return subtle;
};

const computeSha256 = async (file: File) => {
  const subtle = requireSubtleCrypto();
  const content = await file.arrayBuffer();
  const digest = await subtle.digest('SHA-256', content);

  return {
    checksumSha256: toHex(digest),
    content,
  };
};

const createIntent = async (payload: CreateUploadIntentPayload) =>
  apiRequest<CreateUploadIntentResponse>(API_ENDPOINTS.uploads.intent(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    idempotency: {
      identity: createIdempotencyIdentity('document-upload-intent', [
        payload.checksumSha256,
        payload.sizeBytes,
        payload.originalName,
        payload.sourceModule,
        payload.relatedEntityType,
        payload.relatedEntityId,
      ]),
      ttlMs: FORM_IDEMPOTENCY_TTL_MS,
    },
    body: JSON.stringify(payload),
  });

const storeContent = async (uploadId: string, content: ArrayBuffer) =>
  apiRequest<StoreUploadContentResponse>(API_ENDPOINTS.uploads.content(uploadId), {
    method: 'PUT',
    timeoutMs: API_DOWNLOAD_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: content,
  });

export const uploadsApi = {
  buildDocumentDownloadUrl: (documentId: string) => API_ENDPOINTS.me.documentDownload(documentId),
  buildDocumentPreviewUrl: (documentId: string) => API_ENDPOINTS.me.documentPreview(documentId),

  async uploadFiles(files: File[], options: UploadFilesOptions) {
    const results: StoreUploadContentResponse[] = [];

    for (const file of files) {
      const { checksumSha256, content } = await computeSha256(file);
      const intent = await createIntent({
        checksumSha256,
        mimeType: file.type || 'application/octet-stream',
        originalName: file.name,
        relatedEntityId: options.relatedEntityId,
        relatedEntityType: options.relatedEntityType,
        sizeBytes: file.size,
        sourceModule: options.sourceModule,
      });
      const stored = await storeContent(intent.uploadId, content);
      results.push(stored);
    }

    return results;
  },
};
