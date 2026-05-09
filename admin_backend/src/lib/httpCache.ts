import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AdminActor } from '../modules/auth/service.js';

const normalizeIfNoneMatch = (value: string | undefined) =>
  new Set(
    (value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

export const createPrivateEtag = (
  actor: AdminActor,
  scope: string,
  payload: unknown
) => {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        actorId: actor.id,
        permissionCodes: [...actor.permissionCodes].sort(),
        payload,
        scope,
        sessionId: actor.sessionId ?? null,
      })
    )
    .digest('base64url');

  return `"admin-${digest.slice(0, 32)}"`;
};

export const sendPrivateJsonWithEtag = (
  request: Request,
  response: Response,
  options: {
    actor: AdminActor;
    payload: unknown;
    scope: string;
  }
) => {
  const etag = createPrivateEtag(options.actor, options.scope, options.payload);

  response.setHeader('Cache-Control', 'private, no-cache');
  response.setHeader('ETag', etag);
  response.setHeader('Vary', 'Cookie, Authorization');

  if (normalizeIfNoneMatch(request.header('if-none-match')).has(etag)) {
    response.status(304).end();
    return;
  }

  response.json(options.payload);
};
