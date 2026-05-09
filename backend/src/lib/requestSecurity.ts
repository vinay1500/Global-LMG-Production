import type { Request } from 'express';

export const getRequestIpAddress = (request: Request) => {
  // Express computes req.ip according to the configured trust-proxy hop count.
  // Do not trust raw x-forwarded-for here; proxy chain policy belongs in Express.
  return request.ip || request.socket.remoteAddress || 'unknown';
};

export const getRequestUserAgent = (request: Request) =>
  request.header('user-agent')?.trim() || null;
