import type { Request } from 'express';

export const getRequestIpAddress = (request: Request) => {
  // Express computes req.ip according to app.set('trust proxy', 1). Do not trust raw
  // x-forwarded-for here; proxy chain policy belongs in Express configuration.
  return request.ip || request.socket.remoteAddress || 'unknown';
};

export const getRequestUserAgent = (request: Request) =>
  request.header('user-agent')?.trim() || null;
