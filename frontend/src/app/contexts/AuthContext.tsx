import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { PlatformUser } from '../data/dashboardTypes';
import { authApi } from '../lib/api/auth';
import type { AuthActionResponse, AuthSessionUser } from '../lib/api/contracts';
import { AuthContext } from './AuthContextStore';
import type {
  AuthActionResult,
  AuthMode,
  GoogleSignInPayload,
  PasswordResetRequestPayload,
  PhoneCapturePayload,
  ResetPasswordPayload,
  SignInPayload,
  SignUpPayload,
  VerificationPayload,
} from './AuthContextStore';

const toPlatformUser = (user: AuthSessionUser): PlatformUser => ({
  avatar: user.avatar,
  email: user.email,
  id: user.id,
  joinedAt: user.joinedAt,
  lastActiveAt: user.lastActiveAt,
  lifecycle: user.lifecycle as PlatformUser['lifecycle'],
  name: user.name,
  owner: user.owner,
  phone: user.phone,
  region: user.region,
});

const toAuthActionResult = (response: AuthActionResponse): AuthActionResult => ({
  deliveryHint: response.deliveryHint,
  email: response.email,
  message: response.message,
  phone: response.phone,
  status: response.status,
  user: response.user ? toPlatformUser(response.user) : undefined,
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<PlatformUser | null>(null);
  const [isAuthReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);

  const applyAuthResult = (response: AuthActionResponse): AuthActionResult => {
    const result = toAuthActionResult(response);

    if (result.status === 'authenticated' && result.user) {
      setCurrentUser(result.user);
      setAuthModalOpen(false);
    }

    return result;
  };

  const loadSession = useCallback(async () => {
    try {
      const session = await authApi.getSession();
      setCurrentUser(session.authenticated && session.user ? toPlatformUser(session.user) : null);
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthReady(true);
    }
  }, []);

  const ensureAuthReady = useCallback(async () => {
    if (!bootstrapPromiseRef.current) {
      bootstrapPromiseRef.current = loadSession().finally(() => {
        bootstrapPromiseRef.current = null;
      });
    }

    await bootstrapPromiseRef.current;
  }, [loadSession]);

  useEffect(() => {
    void ensureAuthReady();
  }, [ensureAuthReady]);

  const openAuthModal = (mode: AuthMode = 'signin') => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthMode('signin');
    setAuthModalOpen(false);
  };

  const signIn = async (payload: SignInPayload): Promise<AuthActionResult> => {
    await ensureAuthReady();
    return applyAuthResult(await authApi.signIn(payload));
  };

  const signUp = async (payload: SignUpPayload): Promise<AuthActionResult> => {
    await ensureAuthReady();
    setAuthMode('signup');
    return applyAuthResult(await authApi.signUp(payload));
  };

  const issueGoogleNonce = async () => {
    await ensureAuthReady();
    return authApi.issueGoogleNonce();
  };

  const signInWithGoogle = async (
    payload: GoogleSignInPayload
  ): Promise<AuthActionResult> => {
    await ensureAuthReady();
    return applyAuthResult(await authApi.signInWithGoogle(payload));
  };

  const verifyEmail = async (payload: VerificationPayload): Promise<AuthActionResult> => {
    return applyAuthResult(await authApi.verifyEmail(payload));
  };

  const submitGooglePhone = async (
    payload: PhoneCapturePayload
  ): Promise<AuthActionResult> => {
    return applyAuthResult(await authApi.submitGooglePhone(payload));
  };

  const verifyPhoneOtp = async (payload: VerificationPayload): Promise<AuthActionResult> => {
    return applyAuthResult(await authApi.verifyPhoneOtp(payload));
  };

  const requestPasswordReset = async (
    payload: PasswordResetRequestPayload
  ): Promise<AuthActionResult> => {
    await ensureAuthReady();
    return applyAuthResult(await authApi.requestPasswordReset(payload));
  };

  const resetPassword = async (payload: ResetPasswordPayload): Promise<AuthActionResult> => {
    setAuthMode('signin');
    return applyAuthResult(await authApi.resetPassword(payload));
  };

  const resendEmailVerification = async (): Promise<AuthActionResult> => {
    return applyAuthResult(await authApi.resendEmailVerification());
  };

  const resendPasswordReset = async (): Promise<AuthActionResult> => {
    return applyAuthResult(await authApi.resendPasswordReset());
  };

  const resendPhoneOtp = async (): Promise<AuthActionResult> => {
    return applyAuthResult(await authApi.resendPhoneOtp());
  };

  const signOut = useCallback(async () => {
    try {
      await authApi.signOut();
    } finally {
      setCurrentUser(null);
      setAuthMode('signin');
      setAuthModalOpen(false);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: Boolean(currentUser),
        isAuthReady,
        isAuthModalOpen,
        authMode,
        openAuthModal,
        closeAuthModal,
        setAuthMode,
        signIn,
        signUp,
        issueGoogleNonce,
        signInWithGoogle,
        verifyEmail,
        submitGooglePhone,
        verifyPhoneOtp,
        requestPasswordReset,
        resetPassword,
        resendEmailVerification,
        resendPasswordReset,
        resendPhoneOtp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
