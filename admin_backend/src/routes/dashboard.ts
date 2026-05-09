import { Router } from 'express';
import { asyncHandler } from '../lib/httpErrors.js';
import { sendPrivateJsonWithEtag } from '../lib/httpCache.js';
import { getWorkspace } from '../modules/dashboard/service.js';
import { requireReadPermission } from './shared.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/dashboard',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'dashboard.view');
    sendPrivateJsonWithEtag(request, response, {
      actor,
      payload: await getWorkspace(actor.userId),
      scope: 'admin.dashboard',
    });
  })
);
