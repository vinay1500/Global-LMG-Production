import { Router } from 'express';
import { asyncHandler } from '../lib/httpErrors.js';
import { listEntries } from '../modules/audit/service.js';
import { requireReadPermission } from './shared.js';

export const auditRouter = Router();

auditRouter.get(
  '/audit',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'audit.view');
    response.json(
      await listEntries({
        limit: Number(request.query.limit || 50),
        offset: Number(request.query.offset || 0),
      })
    );
  })
);
