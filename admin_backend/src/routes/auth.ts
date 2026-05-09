import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/httpErrors.js';
import { getRequestIpAddress } from '../lib/requestSecurity.js';
import {
  getAdminAccount,
  updateAdminPreferences,
  updateAdminProfile,
} from '../modules/account/service.js';
import {
  changePassword,
  disableMfa,
  getSession,
  requestPasswordReset,
  requireAdminSession,
  resetPassword,
  signIn,
  signOut,
  startMfaEnrollment,
  verifyMfaEnrollment,
  verifyMfaSignIn,
} from '../modules/auth/service.js';

export const authRouter = Router();

const signInSchema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(8),
  rememberMe: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(255),
});

const passwordResetConfirmSchema = z.object({
  code: z.string().trim().min(4).max(20),
  newPassword: z.string().min(12),
  token: z.string().trim().min(10).max(120),
});

const mfaSignInSchema = z.object({
  code: z.string().trim().min(6).max(32),
  mfaToken: z.string().trim().min(10).max(180),
});

const mfaEnrollmentVerifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});

const mfaDisableSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
  currentPassword: z.string().min(1),
});

const profileUpdateSchema = z.object({
  city: z.string().trim().max(100).nullable().optional(),
  displayName: z.string().trim().min(2).max(160).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  state: z.string().trim().max(100).nullable().optional(),
});

const preferencesUpdateSchema = z.object({
  avatarColor: z.string().trim().max(32).optional(),
  dateFormat: z.string().trim().min(2).max(32).optional(),
  defaultLandingPath: z
    .enum([
      '/dashboard',
      '/clients',
      '/matters',
      '/requests',
      '/billing',
      '/messages',
      '/documents',
      '/meetings',
      '/reports',
      '/notifications',
    ])
    .optional(),
  densityCode: z.enum(['comfortable', 'compact']).optional(),
  inAppNotificationsEnabled: z.boolean().optional(),
  timezoneName: z.string().trim().min(1).max(64).optional(),
});

authRouter.get(
  '/auth/session',
  asyncHandler(async (request, response) => {
    response.json(await getSession(request, response));
  })
);

authRouter.get(
  '/auth/me',
  asyncHandler(async (request, response) => {
    const actor = await requireAdminSession(request);
    response.json(await getAdminAccount(actor));
  })
);

authRouter.patch(
  '/auth/me',
  asyncHandler(async (request, response) => {
    const actor = await requireAdminSession(request, { requireCsrf: true });
    response.json(await updateAdminProfile(actor, profileUpdateSchema.parse(request.body)));
  })
);

authRouter.patch(
  '/auth/preferences',
  asyncHandler(async (request, response) => {
    const actor = await requireAdminSession(request, { requireCsrf: true });
    response.json(await updateAdminPreferences(actor, preferencesUpdateSchema.parse(request.body)));
  })
);

authRouter.post(
  '/auth/sign-in',
  asyncHandler(async (request, response) => {
    const payload = signInSchema.parse(request.body);
    response.json(
      await signIn(
        payload.identifier,
        payload.password,
        Boolean(payload.rememberMe),
        request,
        response
      )
    );
  })
);

authRouter.post(
  '/auth/mfa/sign-in',
  asyncHandler(async (request, response) => {
    const payload = mfaSignInSchema.parse(request.body);
    response.json(await verifyMfaSignIn(payload, request, response));
  })
);

authRouter.post(
  '/auth/mfa/enrollment',
  asyncHandler(async (request, response) => {
    response.status(201).json(await startMfaEnrollment(request));
  })
);

authRouter.post(
  '/auth/mfa/enrollment/verify',
  asyncHandler(async (request, response) => {
    const payload = mfaEnrollmentVerifySchema.parse(request.body);
    response.json(await verifyMfaEnrollment(request, payload.code));
  })
);

authRouter.post(
  '/auth/mfa/disable',
  asyncHandler(async (request, response) => {
    const payload = mfaDisableSchema.parse(request.body);
    response.json(await disableMfa(request, payload));
  })
);

authRouter.post(
  '/auth/password-reset/request',
  asyncHandler(async (request, response) => {
    const payload = passwordResetRequestSchema.parse(request.body);
    response.json(
      await requestPasswordReset(payload.identifier, {
        ipAddress: getRequestIpAddress(request),
      })
    );
  })
);

authRouter.post(
  '/auth/password-reset/confirm',
  asyncHandler(async (request, response) => {
    const payload = passwordResetConfirmSchema.parse(request.body);
    response.json(await resetPassword(payload));
  })
);

authRouter.post(
  '/auth/password',
  asyncHandler(async (request, response) => {
    const payload = changePasswordSchema.parse(request.body);
    response.json(await changePassword(request, payload.currentPassword, payload.newPassword));
  })
);

authRouter.post(
  '/auth/sign-out',
  asyncHandler(async (request, response) => {
    response.json(await signOut(request, response));
  })
);
