import express, { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { requireAuthenticatedUser } from '../lib/authSession.js';
import { requireCsrf } from '../lib/csrf.js';
import { asyncHandler, forbidden } from '../lib/httpErrors.js';
import { env } from '../config/env.js';
import { runIdempotentJson } from '../lib/idempotency.js';
import { documentStorageService } from '../modules/storage/service.js';

export const uploadsRouter = Router();

const uploadIntentSchema = z.object({
  checksumSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  mimeType: z.string().trim().min(3).max(160),
  originalName: z.string().trim().min(1).max(255),
  relatedEntityId: z.string().trim().min(1).max(128).optional(),
  relatedEntityType: z.string().trim().min(1).max(64).optional(),
  sizeBytes: z.coerce.number().int().positive().max(env.DOCUMENT_UPLOAD_MAX_BYTES),
  sourceModule: z.string().trim().min(2).max(64),
});

const sanitizeDownloadFilename = (value: string) =>
  value.replace(/["\r\n]+/g, '_').trim() || 'download.bin';

const getUploadIdParam = (request: Request) =>
  Array.isArray(request.params.uploadId) ? request.params.uploadId[0] || '' : request.params.uploadId;

uploadsRouter.post(
  '/uploads/intents',
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const payload = uploadIntentSchema.parse(request.body);
    const result = await runIdempotentJson(request, {
      actorKey: authenticatedUser.id,
      operation: () => documentStorageService.createUploadIntent(authenticatedUser.id, payload),
      scope: 'client:upload:intent:create',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

uploadsRouter.put(
  '/uploads/:uploadId/content',
  express.raw({
    limit: env.DOCUMENT_UPLOAD_MAX_BYTES,
    type: 'application/octet-stream',
  }),
  asyncHandler(async (request, response) => {
    requireCsrf(request);
    const authenticatedUser = await requireAuthenticatedUser(request, response);

    if (!Buffer.isBuffer(request.body)) {
      throw forbidden('invalid_upload_body', 'Upload content must be sent as application/octet-stream.');
    }

    const upload = await documentStorageService.storeUploadContent(
      authenticatedUser.id,
      getUploadIdParam(request),
      request.body
    );

    response.json({
      status: 'stored',
      upload,
    });
  })
);

uploadsRouter.get(
  '/uploads/:uploadId/download',
  asyncHandler(async (request, response) => {
    const authenticatedUser = await requireAuthenticatedUser(request, response);
    const result = await documentStorageService.getDownloadFile(
      authenticatedUser.id,
      getUploadIdParam(request)
    );

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeDownloadFilename(result.upload.originalName)}"`
    );
    response.setHeader('Content-Type', result.upload.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(result.content);
  })
);
