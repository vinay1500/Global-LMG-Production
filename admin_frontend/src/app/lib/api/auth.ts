import type {
  AdminAccountResponse,
  AdminMfaDisableResponse,
  AdminMfaEnrollmentStartResponse,
  AdminMfaEnrollmentVerifyResponse,
  AdminPasswordChangeResponse,
  AdminPasswordResetConfirmResponse,
  AdminPasswordResetRequestResponse,
  AdminSessionResponse,
  UpdateAdminPreferencesPayload,
  UpdateAdminProfilePayload,
} from './contracts';
import { apiRequest } from './client';
import { API_ENDPOINTS } from './endpoints';

const postJson = <TResponse>(url: string, payload?: unknown) =>
  apiRequest<TResponse>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

export const authApi = {
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    postJson<AdminPasswordChangeResponse>(API_ENDPOINTS.admin.auth.password(), payload),
  disableMfa: (payload: { code: string; currentPassword: string }) =>
    postJson<AdminMfaDisableResponse>(API_ENDPOINTS.admin.auth.mfaDisable(), payload),
  confirmPasswordReset: (payload: { code: string; newPassword: string; token: string }) =>
    postJson<AdminPasswordResetConfirmResponse>(
      API_ENDPOINTS.admin.auth.passwordResetConfirm(),
      payload
    ),
  getAccount: () => apiRequest<AdminAccountResponse>(API_ENDPOINTS.admin.auth.me()),
  getSession: () => apiRequest<AdminSessionResponse>(API_ENDPOINTS.admin.auth.session()),
  startMfaEnrollment: () =>
    postJson<AdminMfaEnrollmentStartResponse>(API_ENDPOINTS.admin.auth.mfaEnrollment()),
  verifyMfaEnrollment: (payload: { code: string }) =>
    postJson<AdminMfaEnrollmentVerifyResponse>(
      API_ENDPOINTS.admin.auth.mfaEnrollmentVerify(),
      payload
    ),
  verifyMfaSignIn: (payload: { code: string; mfaToken: string }) =>
    postJson<AdminSessionResponse>(API_ENDPOINTS.admin.auth.mfaSignIn(), payload),
  requestPasswordReset: (payload: { identifier: string }) =>
    postJson<AdminPasswordResetRequestResponse>(
      API_ENDPOINTS.admin.auth.passwordResetRequest(),
      payload
    ),
  updatePreferences: (payload: UpdateAdminPreferencesPayload) =>
    apiRequest<AdminAccountResponse>(API_ENDPOINTS.admin.auth.preferences(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  updateProfile: (payload: UpdateAdminProfilePayload) =>
    apiRequest<AdminAccountResponse>(API_ENDPOINTS.admin.auth.me(), {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }),
  signIn: (payload: { identifier: string; password: string; rememberMe: boolean }) =>
    postJson<AdminSessionResponse>(API_ENDPOINTS.admin.auth.signIn(), payload),
  signOut: () => apiRequest<void>(API_ENDPOINTS.admin.auth.signOut(), { method: 'POST' }),
};
