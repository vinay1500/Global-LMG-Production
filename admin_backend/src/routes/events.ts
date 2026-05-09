import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest } from '../lib/httpErrors.js';
import { cancelEvent, createEvent, getWorkspace, retryEventCalendarSync, updateEvent } from '../modules/events/service.js';
import {
  isAllowedPlatformTimezone,
  PLATFORM_TIMEZONE_PATTERN,
} from '../modules/settings/platformSettings.js';
import { parsePaginationQuery } from './queryValidation.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const eventsRouter = Router();

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().url().optional());

const timezoneSchema = z
  .string()
  .regex(PLATFORM_TIMEZONE_PATTERN)
  .refine(isAllowedPlatformTimezone, {
    message: 'Timezone must be one of the supported platform timezones.',
  })
  .optional();

const createEventSchema = z.object({
  clientAccountId: z.string().trim().min(2).optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: z.coerce.number().int().positive().max(720).optional(),
  matterId: z.string().trim().min(2).optional(),
  meetLink: optionalUrl,
  mode: z.string().trim().min(2).max(32),
  notes: z.string().trim().max(4000).optional(),
  time: z.string().trim().regex(/^\d{2}:\d{2}$/),
  timezone: timezoneSchema,
  title: z.string().trim().min(2).max(255),
  type: z.string().trim().min(2).max(32),
  visibleToClient: z.boolean().optional(),
});

const hasEffectiveEventPatchValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
};

export const updateEventSchema = z.object({
  clientAccountId: z.string().trim().min(2).optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  durationMinutes: z.coerce.number().int().positive().max(720).optional(),
  matterId: z.string().trim().min(2).nullable().optional(),
  meetLink: z.union([optionalUrl, z.null()]).optional(),
  mode: z.string().trim().min(2).max(32).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  time: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: timezoneSchema,
  title: z.string().trim().min(2).max(255).optional(),
  type: z.string().trim().min(2).max(32).optional(),
  visibleToClient: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one event field is required.',
}).refine((value) => Object.values(value).some(hasEffectiveEventPatchValue), {
  message: 'At least one non-empty event field is required.',
});

const cancelEventSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

eventsRouter.get(
  '/events',
  asyncHandler(async (request, response) => {
    await requireReadPermission(request, 'event.view');
    response.json(await getWorkspace(parsePaginationQuery(request.query)));
  })
);

eventsRouter.post(
  '/events',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'event.manage');
    const payload = createEventSchema.parse(request.body);

    if (!payload.clientAccountId && !payload.matterId) {
      throw badRequest(
        'event_context_required',
        'Either matterId or clientAccountId is required to create an event.'
      );
    }

    response.status(201).json(await createEvent(actor, payload));
  })
);

eventsRouter.patch(
  '/events/:eventId',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'event.manage');
    response.json(
      await updateEvent(actor, String(request.params.eventId || ''), updateEventSchema.parse(request.body))
    );
  })
);

eventsRouter.post(
  '/events/:eventId/cancel',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'event.manage');
    response.json(
      await cancelEvent(actor, String(request.params.eventId || ''), cancelEventSchema.parse(request.body))
    );
  })
);

eventsRouter.post(
  '/events/:eventId/calendar-sync/retry',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'event.manage');
    response.json(await retryEventCalendarSync(actor, String(request.params.eventId || '')));
  })
);
