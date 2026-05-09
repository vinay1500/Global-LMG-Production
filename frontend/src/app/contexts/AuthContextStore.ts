import { createContext } from 'react';
import type { PlatformUser } from '../data/dashboardTypes';

export type AuthMode = 'signin' | 'signup';

export interface SignInPayload {
  identifier: string;
  password: string;
  rememberMe: boolean;
}

export interface SignUpPayload {
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
  fullName: string;
  email: string;
  phone: string;
  password: string;
  country: string;
  acceptTerms: boolean;
}

export interface GoogleSignInPayload {
  credential?: string;
  nonce: string;
  rememberMe: boolean;
}

export interface GoogleNonceResult {
  expiresAt: string;
  nonce: string;
}

export interface VerificationPayload {
  code: string;
}

export interface PhoneCapturePayload {
  phone: string;
  country: string;
}

export interface PasswordResetRequestPayload {
  identifier: string;
}

export interface ResetPasswordPayload {
  email: string;
  code: string;
  password: string;
}

export interface AuthActionResult {
  status:
    | 'authenticated'
    | 'email_verification_required'
    | 'phone_capture_required'
    | 'phone_otp_required'
    | 'password_reset_requested'
    | 'password_reset_completed';
  message: string;
  deliveryHint?: string;
  email?: string;
  phone?: string;
  user?: PlatformUser;
}

export interface AuthContextType {
  currentUser: PlatformUser | null;
  isAuthenticated: boolean;
  isAuthReady: boolean;
  isAuthModalOpen: boolean;
  authMode: AuthMode;
  openAuthModal: (mode?: AuthMode) => void;
  closeAuthModal: () => void;
  setAuthMode: (mode: AuthMode) => void;
  signIn: (payload: SignInPayload) => Promise<AuthActionResult>;
  signUp: (payload: SignUpPayload) => Promise<AuthActionResult>;
  issueGoogleNonce: () => Promise<GoogleNonceResult>;
  signInWithGoogle: (payload: GoogleSignInPayload) => Promise<AuthActionResult>;
  verifyEmail: (payload: VerificationPayload) => Promise<AuthActionResult>;
  submitGooglePhone: (payload: PhoneCapturePayload) => Promise<AuthActionResult>;
  verifyPhoneOtp: (payload: VerificationPayload) => Promise<AuthActionResult>;
  requestPasswordReset: (payload: PasswordResetRequestPayload) => Promise<AuthActionResult>;
  resetPassword: (payload: ResetPasswordPayload) => Promise<AuthActionResult>;
  resendEmailVerification: () => Promise<AuthActionResult>;
  resendPasswordReset: () => Promise<AuthActionResult>;
  resendPhoneOtp: () => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
