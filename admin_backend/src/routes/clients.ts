import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { runIdempotentJson } from '../lib/idempotency.js';
import { createClient, getClientWorkspace, listClients } from '../modules/clients/service.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const clientsRouter = Router();

const createClientSchema = z.object({
  city: z.string().trim().max(100).optional(),
  clientType: z.enum(['individual', 'business', 'organization']).optional(),
  displayName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(255),
  notes: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(40).optional(),
  portalAccessEnabled: z.boolean().optional(),
  primaryContactName: z.string().trim().min(2).max(160),
  state: z.string().trim().max(100).optional(),
});

clientsRouter.get(
  '/clients',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'client_account.view');
    response.json(
      await listClients({
        limit: Number(request.query.limit || 50),
        offset: Number(request.query.offset || 0),
        search: typeof request.query.search === 'string' ? request.query.search : undefined,
      })
    );
  })
);

clientsRouter.post(
  '/clients',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'client_account.manage');
    const payload = createClientSchema.parse(request.body);
    const result = await runIdempotentJson(request, {
      actorKey: actor.id,
      actorUserId: actor.userId,
      operation: () => createClient(actor, payload),
      scope: 'admin:client:create',
      statusCode: 201,
    });
    response.setHeader('Idempotency-Replayed', result.replayed ? 'true' : 'false');
    response.status(result.statusCode).json(result.body);
  })
);

clientsRouter.get(
  '/clients/:clientAccountId',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'client_account.view');
    response.json(await getClientWorkspace(String(request.params.clientAccountId || '')));
  })
);
