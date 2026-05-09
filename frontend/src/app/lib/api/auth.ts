import type { AuthActionResponse, AuthSessionResponse } from './contracts';
import { API_ENDPOINTS } from './endpoints';
import { apiRequest } from './client';

const postJson = <TResponse>(url: string, payload?: unknown) =>
  apiRequest<TResponse>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

export const authApi = {
  getSession: () => apiRequest<AuthSessionResponse>(API_ENDPOINTS.auth.session()),
  issueGoogleNonce: () =>
    postJson<{ expiresAt: string; nonce: string }>(API_ENDPOINTS.auth.googleNonce()),
  signIn: (payload: { identifier: string; password: string; rememberMe: boolean }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.signIn(), payload),
  signUp: (payload: {
    acceptTerms: boolean;
    address: {
      city: string;
      country: string;
      line1: string;
      line2?: string;
      postalCode: string;
      sourceCode?: 'google' | 'ip_prefill' | 'manual';
      state: string;
      googlePlaceId?: string | null;
      validationStatusCode?: 'manual' | 'unverified' | 'verified';
    };
    country: string;
    email: string;
    fullName: string;
    password: string;
    phone: string;
  }) => postJson<AuthActionResponse>(API_ENDPOINTS.auth.signUp(), payload),
  signInWithGoogle: (payload: { credential?: string; nonce: string; rememberMe: boolean }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.google(), payload),
  verifyEmail: (payload: { code: string }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.verifyEmail(), payload),
  submitGooglePhone: (payload: { country: string; phone: string }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.submitGooglePhone(), payload),
  verifyPhoneOtp: (payload: { code: string }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.verifyPhoneOtp(), payload),
  requestPasswordReset: (payload: { identifier: string }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.requestPasswordReset(), payload),
  resetPassword: (payload: { code: string; email: string; password: string }) =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.resetPassword(), payload),
  resendEmailVerification: () =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.resendEmailVerification()),
  resendPhoneOtp: () => postJson<AuthActionResponse>(API_ENDPOINTS.auth.resendPhoneOtp()),
  resendPasswordReset: () =>
    postJson<AuthActionResponse>(API_ENDPOINTS.auth.resendPasswordReset()),
  signOut: () => apiRequest<void>(API_ENDPOINTS.auth.signOut(), { method: 'POST' }),
};
