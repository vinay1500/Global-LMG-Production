import type { Request } from 'express';
import { env } from '../config/env.js';
import { timingSafeStringEqual, verifySignedCsrfToken } from './authCrypto.js';
import { forbidden } from './httpErrors.js';
import { parseCookies } from './httpCookies.js';
import { getRequestIpAddress, getRequestUserAgent } from './requestSecurity.js';
import { recordSecurityEventSafely } from './securityEvents.js';

export const requireCsrf = (
  request: Request,
  options: {
    eventTypeCode?: string;
    onInvalidSignedToken?: () => void;
  } = {}
) => {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies[env.CSRF_COOKIE_NAME];
  const headerToken = request.header('x-csrf-token');
  const eventTypeCode = options.eventTypeCode || 'client.csrf_mismatch';

  if (!cookieToken || !headerToken || !timingSafeStringEqual(cookieToken, headerToken)) {
    recordSecurityEventSafely({
      eventTypeCode,
      ipAddress: getRequestIpAddress(request),
      success: false,
      userAgent: getRequestUserAgent(request),
    });
    throw forbidden('csrf_mismatch', 'CSRF validation failed.');
  }

  if (!verifySignedCsrfToken(cookieToken, env.AUTH_SESSION_SECRET)) {
    recordSecurityEventSafely({
      eventTypeCode,
      ipAddress: getRequestIpAddress(request),
      success: false,
      userAgent: getRequestUserAgent(request),
    });
    options.onInvalidSignedToken?.();
    throw forbidden('csrf_invalid', 'CSRF validation failed.');
  }
};
