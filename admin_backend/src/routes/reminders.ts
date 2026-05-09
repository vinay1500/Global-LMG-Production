import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import {
  listReminderWorkspace,
  processDueReminders,
  retryReminder,
} from '../modules/reminders/service.js';
import { parsePaginationQuery } from './queryValidation.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const remindersRouter = Router();

const processSchema = z.object({
  limit: z.coerce.number().int().positive().max(250).optional(),
});

const reminderParamsSchema = z.object({
  reminderId: z.coerce.number().int().positive(),
});

remindersRouter.get(
  '/reminders/workspace',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'event.view');
    response.json(await listReminderWorkspace(parsePaginationQuery(request.query, { maxLimit: 100 })));
  })
);

remindersRouter.post(
  '/reminders/process',
  asyncHandler(async (request, response) => {
    await requireMutationPermission(request, 'event.manage');
    response.json(await processDueReminders(processSchema.parse(request.body || {})));
  })
);

remindersRouter.post(
  '/reminders/:reminderId/retry',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'event.manage');
    const params = reminderParamsSchema.parse(request.params);
    response.json(await retryReminder(actor, params.reminderId));
  })
);
