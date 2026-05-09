import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModal } from './AuthModal';
import { useAuth } from '../../contexts/useAuth';
import type { AuthContextType } from '../../contexts/AuthContextStore';

vi.mock('../../contexts/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../lib/googleIdentity', () => ({
  isGoogleIdentityConfigured: false,
  loadGoogleIdentitySdk: vi.fn(),
  mountGoogleIdentityButton: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

const signUp = vi.fn<AuthContextType['signUp']>();

const renderAuthModal = () =>
  render(
    <MemoryRouter>
      <AuthModal />
    </MemoryRouter>
  );

const fillRequiredSignupFields = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/full name/i), 'Taylor Morgan');
  await user.type(screen.getByLabelText(/^email$/i), 'client@example.com');
  await user.clear(screen.getByLabelText(/phone number/i));
  await user.type(screen.getByLabelText(/phone number/i), '+15555550100');
  await user.type(screen.getByLabelText(/address line 1/i), '1 Main Street');
  await user.type(screen.getByLabelText(/state \/ region/i), 'NY');
  await user.type(screen.getByLabelText(/^city$/i), 'New York');
  await user.type(screen.getByLabelText(/zip code|postal code|pin code/i), '10001');
  await user.type(screen.getByLabelText(/^password$/i), 'Str0ng!Pass2026');
  await user.type(screen.getByPlaceholderText('Repeat your password'), 'Str0ng!Pass2026');
};

beforeEach(() => {
  window.sessionStorage.clear();
  signUp.mockReset();
  signUp.mockResolvedValue({
    deliveryHint: 'Sent to c***@example.com.',
    message: 'Check your email for the verification code.',
    status: 'email_verification_required',
  });

  mockedUseAuth.mockReturnValue({
    authMode: 'signup',
    closeAuthModal: vi.fn(),
    currentUser: null,
    isAuthenticated: false,
    isAuthModalOpen: true,
    isAuthReady: true,
    issueGoogleNonce: vi.fn(),
    openAuthModal: vi.fn(),
    requestPasswordReset: vi.fn(),
    resendEmailVerification: vi.fn(),
    resendPasswordReset: vi.fn(),
    resendPhoneOtp: vi.fn(),
    resetPassword: vi.fn(),
    setAuthMode: vi.fn(),
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    signUp,
    submitGooglePhone: vi.fn(),
    verifyEmail: vi.fn(),
    verifyPhoneOtp: vi.fn(),
  });
});

describe('AuthModal', () => {
  it('blocks signup until the required legal terms checkbox is accepted', async () => {
    const user = userEvent.setup();
    renderAuthModal();

    await fillRequiredSignupFields(user);
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(/you must accept the terms, refund and cancellation policy/i)
    ).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('moves to email verification when signup returns verify_email_required', async () => {
    const user = userEvent.setup();
    renderAuthModal();

    await fillRequiredSignupFields(user);
    await user.click(screen.getByRole('checkbox', { name: /i agree/i }));
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('heading', { name: /verify your email/i })).toBeInTheDocument();
    expect(screen.getByText(/check your email for the verification code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify email/i })).toBeInTheDocument();
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptTerms: true,
        email: 'client@example.com',
      })
    );
  });
});
