import { API_BASE_URL } from '../../config/runtime';

const joinApiPath = (path: string) => {
  const baseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;

  if (baseUrl.endsWith('/v1') && path.startsWith('/v1')) {
    return `${baseUrl}${path.slice('/v1'.length)}`;
  }

  return `${baseUrl}${path}`;
};

export const API_ENDPOINTS = {
  health: () => joinApiPath('/v1/health'),
  auth: {
    session: () => joinApiPath('/v1/auth/session'),
    signIn: () => joinApiPath('/v1/auth/sign-in'),
    signUp: () => joinApiPath('/v1/auth/sign-up'),
    googleNonce: () => joinApiPath('/v1/auth/google/nonce'),
    google: () => joinApiPath('/v1/auth/google'),
    verifyEmail: () => joinApiPath('/v1/auth/verify-email'),
    submitGooglePhone: () => joinApiPath('/v1/auth/google/phone'),
    verifyPhoneOtp: () => joinApiPath('/v1/auth/verify-phone-otp'),
    requestPasswordReset: () => joinApiPath('/v1/auth/password-reset/request'),
    resetPassword: () => joinApiPath('/v1/auth/password-reset/confirm'),
    resendEmailVerification: () => joinApiPath('/v1/auth/email-verification/resend'),
    resendPhoneOtp: () => joinApiPath('/v1/auth/phone-otp/resend'),
    resendPasswordReset: () => joinApiPath('/v1/auth/password-reset/resend'),
    signOut: () => joinApiPath('/v1/auth/sign-out'),
  },
  dashboard: {
    snapshot: () => joinApiPath('/v1/dashboard'),
    requestConfig: () => joinApiPath('/v1/dashboard/request-config'),
    requests: () => joinApiPath('/v1/dashboard/requests'),
    requestPaymentVerify: (requestId: string) =>
      joinApiPath(`/v1/dashboard/requests/${requestId}/payment-verify`),
    messages: () => joinApiPath('/v1/dashboard/messages'),
    messageRead: (threadId: string) => joinApiPath(`/v1/dashboard/messages/${threadId}/read`),
    matterPackageSelection: (matterId: string) =>
      joinApiPath(`/v1/dashboard/matters/${matterId}/package-selection`),
  },
  me: {
    accountAddress: () => joinApiPath('/v1/me/account/address'),
    accountEmailChangeConfirm: () => joinApiPath('/v1/me/account/email-change/confirm'),
    accountEmailChangeRequest: () => joinApiPath('/v1/me/account/email-change/request'),
    accountName: () => joinApiPath('/v1/me/account/name'),
    accountPassword: () => joinApiPath('/v1/me/account/password'),
    accountPhoneChangeConfirm: () => joinApiPath('/v1/me/account/phone-change/confirm'),
    accountPhoneChangeRequest: () => joinApiPath('/v1/me/account/phone-change/request'),
    accountSettings: () => joinApiPath('/v1/me/account-settings'),
    preferences: () => joinApiPath('/v1/me/preferences'),
    documentDownload: (documentId: string) =>
      joinApiPath(`/v1/me/documents/${documentId}/download`),
    documentPreview: (documentId: string) =>
      joinApiPath(`/v1/me/documents/${documentId}/preview`),
    invoiceDetail: (invoiceId: string) => joinApiPath(`/v1/me/invoices/${invoiceId}`),
    invoiceDownload: (invoiceId: string) =>
      joinApiPath(`/v1/me/invoices/${invoiceId}/download`),
    invoicePaymentOrder: (invoiceId: string) =>
      joinApiPath(`/v1/me/invoices/${invoiceId}/payment-order`),
    invoicePaymentVerify: (invoiceId: string) =>
      joinApiPath(`/v1/me/invoices/${invoiceId}/payment-verify`),
    payments: () => joinApiPath('/v1/me/payments'),
    refunds: () => joinApiPath('/v1/me/refunds'),
  },
  notifications: {
    list: () => joinApiPath('/v1/notifications'),
    markRead: (notificationId: string) =>
      joinApiPath(`/v1/notifications/${notificationId}/read`),
    dismiss: (notificationId: string) =>
      joinApiPath(`/v1/notifications/${notificationId}/dismiss`),
  },
  uploads: {
    intent: () => joinApiPath('/v1/uploads/intents'),
    content: (uploadId: string) => joinApiPath(`/v1/uploads/${uploadId}/content`),
  },
};
