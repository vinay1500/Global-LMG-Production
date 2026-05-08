import { Router } from 'express';
import { asyncHandler } from '../lib/httpErrors.js';
import { dismiss, listNotifications, markRead } from '../modules/notifications/service.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/notifications',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'notification.view');
    response.json(
      await listNotifications({
        limit: Number(request.query.limit || 50),
        offset: Number(request.query.offset || 0),
      })
    );
  })
);

notificationsRouter.post(
  '/notifications/:notificationId/read',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'notification.view');
    response.json(await markRead(actor, String(request.params.notificationId || '')));
  })
);

notificationsRouter.post(
  '/notifications/:notificationId/dismiss',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'notification.view');
    response.json(await dismiss(actor, String(request.params.notificationId || '')));
  })
);
