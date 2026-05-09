import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../lib/api/auth';
import { ApiRequestError } from '../lib/api/client';
import type { AdminSessionUser } from '../lib/api/contracts';

type AdminSessionContextValue = {
  changePassword: (payload: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<void>;
  currentUser: AdminSessionUser | null;
  errorMessage: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  mustRotatePassword: boolean;
  refreshSession: () => Promise<void>;
  signIn: (payload: {
    identifier: string;
    password: string;
    rememberMe: boolean;
  }) => Promise<{
    message?: string;
    mfaToken?: string;
    status: 'authenticated' | 'mfa_required' | 'password_rotation_required';
  }>;
  signOut: () => Promise<void>;
  verifyMfa: (payload: {
    code: string;
    mfaToken: string;
  }) => Promise<{ status: 'authenticated' | 'password_rotation_required' }>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export const AdminSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<AdminSessionUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      const session = await authApi.getSession();
      setCurrentUser(session.authenticated ? session.user : null);
      setErrorMessage(null);
    } catch (error) {
      setCurrentUser(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to verify session.');
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(
    async (payload: { identifier: string; password: string; rememberMe: boolean }) => {
      setErrorMessage(null);
      const response = await authApi.signIn(payload);

      if (response.authenticated) {
        setCurrentUser(response.user ?? null);
        return {
          status: response.user?.mustRotatePassword
            ? 'password_rotation_required'
            : 'authenticated',
        } as const;
      }

      if (response.mfaRequired && response.mfaToken) {
        return {
          message: response.message,
          mfaToken: response.mfaToken,
          status: 'mfa_required',
        } as const;
      }

      throw new ApiRequestError(
        'admin_auth_incomplete',
        'This account needs an additional auth step before admin access.'
      );
    },
    []
  );

  const verifyMfa = useCallback(
    async (payload: { code: string; mfaToken: string }) => {
      setErrorMessage(null);
      const response = await authApi.verifyMfaSignIn(payload);

      if (!response.authenticated || !response.user) {
        throw new ApiRequestError(
          'admin_auth_incomplete',
          'This account needs an additional auth step before admin access.'
        );
      }

      setCurrentUser(response.user);
      return {
        status: response.user.mustRotatePassword ? 'password_rotation_required' : 'authenticated',
      } as const;
    },
    []
  );

  const changePassword = useCallback(
    async (payload: { currentPassword: string; newPassword: string }) => {
      setErrorMessage(null);
      const response = await authApi.changePassword(payload);
      setCurrentUser(response.user);
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.signOut();
    } finally {
      setCurrentUser(null);
    }
  }, []);

  const value = useMemo<AdminSessionContextValue>(
    () => ({
      changePassword,
      currentUser,
      errorMessage,
      isAuthenticated: Boolean(currentUser),
      isReady,
      mustRotatePassword: Boolean(currentUser?.mustRotatePassword),
      refreshSession,
      signIn,
      signOut,
      verifyMfa,
    }),
    [changePassword, currentUser, errorMessage, isReady, refreshSession, signIn, signOut, verifyMfa]
  );

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
};

export const useAdminSession = () => {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error('useAdminSession must be used within AdminSessionProvider.');
  }
  return context;
};
