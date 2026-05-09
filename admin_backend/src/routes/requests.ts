import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { sendPrivateJsonWithEtag } from '../lib/httpCache.js';
import {
  approveRequest,
  convertRequest,
  declineRequest,
  getWorkspace,
  requestMoreInformation,
} from '../modules/requests/service.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const requestsRouter = Router();

const decisionSchema = z.object({
  note: z.string().trim().max(4000).optional(),
});

requestsRouter.get(
  '/requests/workspace',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'matter.view');
    sendPrivateJsonWithEtag(request, response, {
      actor,
      payload: await getWorkspace(),
      scope: 'admin.requests.workspace',
    });
  })
);

requestsRouter.post(
  '/requests/:requestId/approve',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await approveRequest(
        actor,
        String(request.params.requestId || ''),
        decisionSchema.parse(request.body)
      )
    );
  })
);

requestsRouter.post(
  '/requests/:requestId/convert',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await convertRequest(
        actor,
        String(request.params.requestId || ''),
        decisionSchema.parse(request.body)
      )
    );
  })
);

requestsRouter.post(
  '/requests/:requestId/decline',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await declineRequest(
        actor,
        String(request.params.requestId || ''),
        decisionSchema.parse(request.body)
      )
    );
  })
);

requestsRouter.post(
  '/requests/:requestId/request-information',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'matter.update');
    response.json(
      await requestMoreInformation(
        actor,
        String(request.params.requestId || ''),
        decisionSchema.parse(request.body)
      )
    );
  })
);
