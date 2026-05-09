import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { createSignedCsrfToken, hashOpaqueValue } from '../lib/authCrypto.js';
import { requireCsrf } from '../lib/csrf.js';
import { asyncHandler, tooManyRequests } from '../lib/httpErrors.js';
import { appendCookie, clearCookie, parseCookies } from '../lib/httpCookies.js';
import { getRequestIpAddress, getRequestUserAgent } from '../lib/requestSecurity.js';
import { recordSecurityEventSafely } from '../lib/securityEvents.js';
import { authService } from '../modules/auth/authService.js';
import { consumePersistentRateLimit } from '../modules/auth/persistentRateLimiter.js';

const authRouter = Router();

const cookieSecurity = {
  path: '/',
  sameSite: 'lax' as const,
  secure: env.APP_ENV !== 'development',
};

const signInSchema = z.object({
  identifier: z.string().trim().min(3).max(160),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean(),
});

const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().min(8).max(40),
  password: z.string().min(1).max(200),
  country: z.string().trim().min(2).max(80),
  address: z.object({
    line1: z.string().trim().min(3).max(255),
    line2: z.string().trim().max(255).optional().default(''),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    postalCode: z.string().trim().min(3).max(20),
    country: z.string().trim().min(2).max(80),
    sourceCode: z.enum(['google', 'ip_prefill', 'manual']).default('manual'),
    googlePlaceId: z.string().trim().max(255).optional().nullable(),
    validationStatusCode: z.enum(['manual', 'unverified', 'verified']).default('manual'),
  }),
  acceptTerms: z.literal(true),
});

const verificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});

const phoneCaptureSchema = z.object({
  phone: z.string().trim().min(8).max(40),
  country: z.string().trim().min(2).max(80),
});

const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(160),
});

const passwordResetSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(1).max(200),
});

const googleAuthSchema = z.object({
  credential: z.string().trim().min(10).max(4096).optional(),
  nonce: z.string().trim().min(16).max(256),
  rememberMe: z.boolean(),
});

const getCookies = (cookieHeader: string | undefined) => parseCookies(cookieHeader);

const setCsrfCookie = (response: Response) => {
  const csrfToken = createSignedCsrfToken(env.AUTH_SESSION_SECRET);
  appendCookie(response, env.CSRF_COOKIE_NAME, csrfToken, {
    ...cookieSecurity,
    httpOnly: false,
  });
};

const requireAuthCsrf = (request: Request, response: Response) =>
  requireCsrf(request, {
    onInvalidSignedToken: () => setCsrfCookie(response),
  });

const assertSignOutRateLimit = async (request: Request) => {
  const rateLimit = await consumePersistentRateLimit({
    key: `signout:ip:${getRequestIpAddress(request)}`,
    maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
    scope: 'client_auth',
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
  });

  if (!rateLimit.allowed) {
    recordSecurityEventSafely({
      eventTypeCode: 'client.rate_limit_blocked',
      identifierValue: `signout:ip:${getRequestIpAddress(request)}`,
      ipAddress: getRequestIpAddress(request),
      success: false,
      userAgent: getRequestUserAgent(request),
    });
    throw tooManyRequests(
      'too_many_attempts',
      'Too many attempts. Please wait before trying again.',
      rateLimit.retryAfterSeconds
    );
  }
};

const consumeAuthActionRateLimit = async (
  actionCode:
    | 'email-verification-resend'
    | 'email-verification-verify'
    | 'google-nonce'
    | 'password-reset-confirm'
    | 'password-reset-resend'
    | 'phone-otp-resend'
    | 'phone-otp-send'
    | 'phone-otp-verify',
  request: Request,
  flowToken?: string
) => {
  const keys = [
    {
      key: `${actionCode}:ip:${getRequestIpAddress(request)}`,
      maxAttempts: env.AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS,
    },
  ];

  if (flowToken) {
    keys.push({
      key: `${actionCode}:flow:${hashOpaqueValue(flowToken, env.AUTH_SESSION_SECRET)}`,
      maxAttempts: env.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    });
  }

  for (const key of keys) {
    const rateLimit = await consumePersistentRateLimit({
      key: key.key,
      maxAttempts: key.maxAttempts,
      scope: 'client_auth',
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    });

    if (!rateLimit.allowed) {
      recordSecurityEventSafely({
        eventTypeCode: 'client.rate_limit_blocked',
        identifierValue: key.key,
        ipAddress: getRequestIpAddress(request),
        success: false,
        userAgent: getRequestUserAgent(request),
      });
      throw tooManyRequests(
        'too_many_attempts',
        'Too many attempts. Please wait before trying again.',
        rateLimit.retryAfterSeconds
      );
    }
  }
};

const setSessionCookie = (
  response: Response,
  rawToken: string,
  rememberMe: boolean
) => {
  appendCookie(response, env.SESSION_COOKIE_NAME, rawToken, {
    ...cookieSecurity,
    httpOnly: true,
    maxAge: rememberMe ? env.REMEMBER_ME_TTL_DAYS * 24 * 60 * 60 : undefined,
  });
};

const setFlowCookie = (response: Response, rawToken: string) => {
  appendCookie(response, env.AUTH_FLOW_COOKIE_NAME, rawToken, {
    ...cookieSecurity,
    httpOnly: true,
    maxAge: env.AUTH_FLOW_TTL_MINUTES * 60,
  });
};

const clearSessionArtifacts = (response: Response) => {
  clearCookie(response, env.SESSION_COOKIE_NAME, cookieSecurity);
  clearCookie(response, env.CSRF_COOKIE_NAME, cookieSecurity);
  clearCookie(response, env.AUTH_FLOW_COOKIE_NAME, cookieSecurity);
};

type AuthCookieMutation = {
  clearFlowCookie?: boolean;
  clearSessionCookie?: boolean;
  flowToken?: string;
  rememberMe?: boolean;
  result: Record<string, unknown>;
  sessionToken?: string;
};

const applyAuthResultCookies = (
  response: Response,
  result: AuthCookieMutation
) => {
  if (result.clearSessionCookie) {
    clearCookie(response, env.SESSION_COOKIE_NAME, cookieSecurity);
  }

  if (result.clearFlowCookie) {
    clearCookie(response, env.AUTH_FLOW_COOKIE_NAME, cookieSecurity);
  }

  if (result.sessionToken) {
    setSessionCookie(response, result.sessionToken, Boolean(result.rememberMe));
  }

  if (result.flowToken) {
    setFlowCookie(response, result.flowToken);
  }
};

authRouter.get(
  '/auth/session',
  asyncHandler(async (request, response) => {
    const cookies = getCookies(request.headers.cookie);
    const resolution = await authService.getSession(cookies[env.SESSION_COOKIE_NAME]);

    if (resolution.clearSessionCookie) {
      clearSessionArtifacts(response);
    }

    setCsrfCookie(response);

    response.json({
      authenticated: Boolean(resolution.user),
      user: resolution.user,
    });
  })
);

authRouter.post(
  '/auth/sign-in',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = signInSchema.parse(request.body);
    const result = await authService.signIn(payload, {
      ipAddress: getRequestIpAddress(request),
    });
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/sign-up',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = signUpSchema.parse(request.body);
    const result = await authService.signUp(payload, {
      ipAddress: getRequestIpAddress(request),
      userAgent: getRequestUserAgent(request),
    });
    applyAuthResultCookies(response, result);
    response.status(201).json(result.result);
  })
);

authRouter.post(
  '/auth/google/nonce',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    await consumeAuthActionRateLimit('google-nonce', request);
    const result = await authService.issueGoogleSignInNonce();
    response.status(201).json(result);
  })
);

authRouter.post(
  '/auth/google',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = googleAuthSchema.parse(request.body);
    const result = await authService.signInWithGoogle(payload);
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/verify-email',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = verificationSchema.parse(request.body);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit(
      'email-verification-verify',
      request,
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    const result = await authService.verifyEmail(cookies[env.AUTH_FLOW_COOKIE_NAME], payload.code);
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/google/phone',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = phoneCaptureSchema.parse(request.body);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit('phone-otp-send', request, cookies[env.AUTH_FLOW_COOKIE_NAME]);
    const result = await authService.submitGooglePhone(
      cookies[env.AUTH_FLOW_COOKIE_NAME],
      payload.phone,
      payload.country
    );
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/verify-phone-otp',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = verificationSchema.parse(request.body);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit(
      'phone-otp-verify',
      request,
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    const result = await authService.verifyPhoneOtp(
      cookies[env.AUTH_FLOW_COOKIE_NAME],
      payload.code
    );
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/password-reset/request',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = passwordResetRequestSchema.parse(request.body);
    const result = await authService.requestPasswordReset(payload.identifier, {
      ipAddress: getRequestIpAddress(request),
    });
    setFlowCookie(response, result.flowToken);
    response.json({
      status: result.status,
      message: result.message,
    });
  })
);

authRouter.post(
  '/auth/password-reset/confirm',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const payload = passwordResetSchema.parse(request.body);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit(
      'password-reset-confirm',
      request,
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    const result = await authService.resetPassword(cookies[env.AUTH_FLOW_COOKIE_NAME], payload);
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/email-verification/resend',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit(
      'email-verification-resend',
      request,
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    const result = await authService.resendEmailVerification(
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/phone-otp/resend',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit('phone-otp-resend', request, cookies[env.AUTH_FLOW_COOKIE_NAME]);
    const result = await authService.resendPhoneOtp(cookies[env.AUTH_FLOW_COOKIE_NAME]);
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/password-reset/resend',
  asyncHandler(async (request, response) => {
    requireAuthCsrf(request, response);
    const cookies = getCookies(request.headers.cookie);
    await consumeAuthActionRateLimit(
      'password-reset-resend',
      request,
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    const result = await authService.resendPasswordReset(
      cookies[env.AUTH_FLOW_COOKIE_NAME]
    );
    applyAuthResultCookies(response, result);
    response.json(result.result);
  })
);

authRouter.post(
  '/auth/sign-out',
  asyncHandler(async (request, response) => {
    await assertSignOutRateLimit(request);
    // Logout is session termination; OWASP treats it as a user safety control, so stale CSRF state must not block the bound session holder.
    const cookies = getCookies(request.headers.cookie);
    await authService.signOut(cookies[env.SESSION_COOKIE_NAME]);
    clearSessionArtifacts(response);
    response.status(204).send();
  })
);

export { authRouter };
