import { Router } from 'express';
import type { Request } from 'express';
import { asyncHandler, tooManyRequests } from '../lib/httpErrors.js';
import { getRequestIpAddress } from '../lib/requestSecurity.js';
import { consumePersistentRateLimit } from '../modules/auth/persistentRateLimiter.js';
import { searchWorkspace } from '../modules/search/service.js';
import { parseRequiredSearchQuery } from './queryValidation.js';
import { requireReadPermission } from './shared.js';

export const searchRouter = Router();

const consumeSearchRateLimit = async (request: Request, actorId: string) => {
  const ipAddress = getRequestIpAddress(request);
  const buckets = [
    { key: `ip:${ipAddress}`, maxAttempts: 180 },
    { key: `actor:${actorId}`, maxAttempts: 240 },
  ];

  for (const bucket of buckets) {
    const result = await consumePersistentRateLimit({
      key: bucket.key,
      maxAttempts: bucket.maxAttempts,
      scope: 'admin_search',
      windowMs: 60_000,
    });
    if (!result.allowed) {
      throw tooManyRequests('admin_search_rate_limited', 'Search is temporarily rate-limited.', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
};

searchRouter.get(
  '/search',
  asyncHandler(async (request, response) => {
    const actor = await requireReadPermission(request, 'dashboard.view');
    const query = parseRequiredSearchQuery(request.query.q);
    await consumeSearchRateLimit(request, actor.id);
    response.json(await searchWorkspace(query));
  })
);
