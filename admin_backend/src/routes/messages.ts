import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { isMessageContentWithinLimit, sanitizeMessageContent } from '../lib/messageContent.js';
import { archiveThread, createThread, getWorkspace, markThreadRead, replyToThread } from '../modules/messages/service.js';
import { requireMutationPermission, requireReadPermission } from './shared.js';

export const messagesRouter = Router();
const ADMIN_MESSAGE_CONTENT_MAX_LENGTH = 4000;

const adminMessageContentSchema = z
  .string()
  .refine(
    (value) => isMessageContentWithinLimit(value, ADMIN_MESSAGE_CONTENT_MAX_LENGTH),
    'Message content must be 4,000 characters or fewer.'
  )
  .transform(sanitizeMessageContent)
  .refine((value) => value.length > 0, 'Message content is required.');

const replySchema = z.object({
  content: adminMessageContentSchema,
  visibleToClient: z.boolean().optional(),
});

const createThreadSchema = z.object({
  clientId: z.string().trim().min(1).max(96),
  confirmDuplicateGeneral: z.boolean().optional(),
  content: adminMessageContentSchema,
  matterId: z.string().trim().min(1).max(96).optional(),
});

messagesRouter.get(
  '/messages/workspace',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'message.send');
    response.json(
      await getWorkspace(actor, {
        limit: Number(request.query.limit || 50),
        offset: Number(request.query.offset || 0),
      })
    );
  })
);

messagesRouter.post(
  '/messages/threads',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'message.send');
    response.status(201).json(await createThread(actor, createThreadSchema.parse(request.body)));
  })
);

messagesRouter.post(
  '/messages/:threadId/replies',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'message.send');
    response.status(201).json(
      await replyToThread(actor, {
        ...replySchema.parse(request.body),
        threadId: String(request.params.threadId || ''),
      })
    );
  })
);

messagesRouter.post(
  '/messages/:threadId/read',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'message.send');
    response.json(await markThreadRead(actor, String(request.params.threadId || '')));
  })
);

messagesRouter.post(
  '/messages/:threadId/archive',
  asyncHandler(async (request, response) => {
    const actor = await requireMutationPermission(request, 'message.send');
    response.json(await archiveThread(actor, String(request.params.threadId || '')));
  })
);
