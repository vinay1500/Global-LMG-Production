import { Router } from 'express';
import { asyncHandler } from '../lib/httpErrors.js';
import { listEntries } from '../modules/audit/service.js';
import { parsePaginationQuery } from './queryValidation.js';
import { requireReadPermission } from './shared.js';

export const auditRouter = Router();

auditRouter.get(
  '/audit',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'audit.view');
    response.json(await listEntries(parsePaginationQuery(request.query)));
  })
);
