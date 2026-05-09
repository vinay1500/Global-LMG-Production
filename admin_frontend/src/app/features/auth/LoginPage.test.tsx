import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { useAdminSession } from '../../providers/AdminSessionProvider';

vi.mock('../../providers/AdminSessionProvider', () => ({
  useAdminSession: vi.fn(),
}));

vi.mock('../../lib/api/auth', () => ({
  authApi: {
    confirmPasswordReset: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}));

const mockedUseAdminSession = vi.mocked(useAdminSession);
const signIn = vi.fn();
const verifyMfa = vi.fn();

const renderLoginPage = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route element={<LoginPage />} path="/login" />
        <Route element={<div>Dashboard route reached</div>} path="/dashboard" />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  signIn.mockReset();
  verifyMfa.mockReset();
  signIn.mockResolvedValue({
    message: 'Enter the code from your authenticator app.',
    mfaToken: 'mfa-token-1',
    status: 'mfa_required',
  });
  verifyMfa.mockResolvedValue({ status: 'authenticated' });
  mockedUseAdminSession.mockReturnValue({
    changePassword: vi.fn(),
    currentUser: null,
    errorMessage: null,
    isAuthenticated: false,
    isReady: true,
    mustRotatePassword: false,
    refreshSession: vi.fn(),
    signIn,
    signOut: vi.fn(),
    verifyMfa,
  });
});

describe('LoginPage MFA challenge', () => {
  it('shows MFA challenge after password sign-in and verifies the submitted code', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email or phone/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'CorrectHorseBattery1!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/authenticator app to finish signing in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/authenticator or recovery code/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/authenticator or recovery code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify & sign in/i }));

    expect(signIn).toHaveBeenCalledWith({
      identifier: 'admin@example.com',
      password: 'CorrectHorseBattery1!',
      rememberMe: true,
    });
    expect(verifyMfa).toHaveBeenCalledWith({
      code: '123456',
      mfaToken: 'mfa-token-1',
    });
    expect(await screen.findByText('Dashboard route reached')).toBeInTheDocument();
  });
});
