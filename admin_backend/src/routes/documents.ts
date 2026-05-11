import express, { type Request, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { asyncHandler, badRequest, forbidden } from '../lib/httpErrors.js';
import {
  getAdminDocumentFile,
  getDocumentDetail,
  listDocuments,
  rescanAdminDocument,
  updateDocumentControls,
  uploadAdminDocument,
  uploadAdminDocumentVersion,
} from '../modules/documents/service.js';
import { parsePaginationQuery } from './queryValidation.js';
import {
  requireAnyReadPermission,
  requireMutationPermission,
} from './shared.js';

export const documentsRouter = Router();

const sanitizeDownloadFilename = (value: string) =>
  value.replace(/["\r\n]+/g, '_').trim() || 'download.bin';

const getSingleQueryValue = (request: Request, name: string) => {
  const value = request.query[name];
  return Array.isArray(value) ? value[0] : value;
};

const adminUploadQuerySchema = z.object({
  categoryCode: z.string().trim().min(1).max(32).default('attachment'),
  checksumSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  fileName: z.string().trim().min(1).max(255),
  matterId: z.string().trim().min(1).max(128),
  mimeType: z.string().trim().min(3).max(160),
  reviewState: z.enum(['reviewed', 'unreviewed']).default('unreviewed'),
  visibility: z.enum(['client', 'internal']).default('internal'),
});

const adminVersionUploadQuerySchema = z.object({
  checksumSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(160),
  reviewState: z.enum(['reviewed', 'unreviewed']).default('unreviewed'),
});

const updateDocumentSchema = z.object({
  reviewState: z.enum(['reviewed', 'unreviewed']),
  visibility: z.enum(['client', 'internal']),
});

const parseAdminUploadQuery = (request: Request) =>
  adminUploadQuerySchema.parse({
    checksumSha256: getSingleQueryValue(request, 'checksumSha256'),
    categoryCode: getSingleQueryValue(request, 'categoryCode') || 'attachment',
    fileName: getSingleQueryValue(request, 'fileName'),
    matterId: getSingleQueryValue(request, 'matterId'),
    mimeType: getSingleQueryValue(request, 'mimeType'),
    reviewState: getSingleQueryValue(request, 'reviewState') || 'unreviewed',
    visibility: getSingleQueryValue(request, 'visibility') || 'internal',
  });

const parseVersionUploadQuery = (request: Request) =>
  adminVersionUploadQuerySchema.parse({
    checksumSha256: getSingleQueryValue(request, 'checksumSha256'),
    fileName: getSingleQueryValue(request, 'fileName'),
    mimeType: getSingleQueryValue(request, 'mimeType'),
    reviewState: getSingleQueryValue(request, 'reviewState') || 'unreviewed',
  });

documentsRouter.get(
  '/documents',
  asyncHandler(async (request, response) => {
    const actor = await requireAnyReadPermission(request, [
      'document.view',
      'document.view_assigned',
    ]);
    response.json(await listDocuments(actor, parsePaginationQuery(request.query)));
  })
);

documentsRouter.get(
  '/documents/:documentId',
  asyncHandler(async (request, response) => {
    const actor = await requireAnyReadPermission(request, [
      'document.view',
      'document.view_assigned',
    ]);
    response.json(await getDocumentDetail(actor, String(request.params.documentId || '')));
  })
);

documentsRouter.get(
  '/documents/:documentId/download',
  asyncHandler(async (request, response) => {
    const actor = await requireAnyReadPermission(request, [
      'document.download',
      'document.download_assigned',
    ]);
    const result = await getAdminDocumentFile(
      actor,
      String(request.params.documentId || ''),
      'download'
    );

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${sanitizeDownloadFilename(result.originalName)}"`);
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(result.content);
  })
);

documentsRouter.get(
  '/documents/:documentId/preview',
  asyncHandler(async (request, response) => {
    const actor = await requireAnyReadPermission(request, [
      'document.view',
      'document.view_assigned',
    ]);
    const result = await getAdminDocumentFile(actor, String(request.params.documentId || ''), 'preview');

    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Disposition', `inline; filename="${sanitizeDownloadFilename(result.originalName)}"`);
    response.setHeader('Content-Security-Policy', 'sandbox');
    response.setHeader('Content-Type', result.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(result.content);
  })
);

documentsRouter.post(
  '/documents/uploads',
  express.raw({
    limit: env.DOCUMENT_UPLOAD_MAX_BYTES,
    type: 'application/octet-stream',
  }),
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'document.manage');
    const payload = parseAdminUploadQuery(request);

    if (!Buffer.isBuffer(request.body)) {
      throw forbidden('invalid_upload_body', 'Upload content must be sent as application/octet-stream.');
    }

    const result = await uploadAdminDocument(actor, {
      ...payload,
      content: request.body,
    });

    response.status(201).json(result);
  })
);

documentsRouter.post(
  '/documents/:documentId/versions',
  express.raw({
    limit: env.DOCUMENT_UPLOAD_MAX_BYTES,
    type: 'application/octet-stream',
  }),
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'document.manage');
    const payload = parseVersionUploadQuery(request);

    if (!Buffer.isBuffer(request.body)) {
      throw badRequest('invalid_upload_body', 'Upload content must be sent as application/octet-stream.');
    }

    const result = await uploadAdminDocumentVersion(
      actor,
      String(request.params.documentId || ''),
      {
        ...payload,
        content: request.body,
      }
    );

    response.status(201).json(result);
  })
);

documentsRouter.patch(
  '/documents/:documentId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'document.manage');
    response.json(
      await updateDocumentControls(
        actor,
        String(request.params.documentId || ''),
        updateDocumentSchema.parse(request.body)
      )
    );
  })
);

documentsRouter.post(
  '/documents/:documentId/scan',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'document.manage');
    response.json(await rescanAdminDocument(actor, String(request.params.documentId || '')));
  })
);
