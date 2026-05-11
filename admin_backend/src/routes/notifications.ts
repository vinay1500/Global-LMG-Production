import { Router } from 'express';
import { asyncHandler } from '../lib/httpErrors.js';
import { dismiss, listNotifications, markRead } from '../modules/notifications/service.js';
import { parsePaginationQuery } from './queryValidation.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/notifications',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'notification.view');
    response.json(await listNotifications(actor, parsePaginationQuery(request.query)));
  })
);

// Read/dismiss changes only the recipient's own notification state with notification.view.
// Updating another admin's notification is blocked in the service unless the actor has notification.manage.
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
