import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Scale } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { authApi } from '../../lib/api/auth';
import { ApiRequestError } from '../../lib/api/client';
import { useAdminSession } from '../../providers/AdminSessionProvider';

type LoginView = 'forgot' | 'mfa' | 'reset' | 'signin';

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, mustRotatePassword, signIn, verifyMfa } = useAdminSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [view, setView] = useState<LoginView>(
    searchParams.get('resetToken') ? 'reset' : 'signin'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetToken, setResetToken] = useState(searchParams.get('resetToken') || '');
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  const from = (location.state as { from?: string } | null)?.from || '/dashboard';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(mustRotatePassword ? '/change-password' : from, {
        replace: true,
        state: { from },
      });
    }
  }, [from, isAuthenticated, mustRotatePassword, navigate]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await signIn({ identifier, password, rememberMe });
      if (result.status === 'mfa_required' && result.mfaToken) {
        setMfaToken(result.mfaToken);
        setMfaCode('');
        setSuccessMessage(result.message || 'Enter the code from your authenticator app.');
        setView('mfa');
        return;
      }
      navigate(result.status === 'password_rotation_required' ? '/change-password' : from, {
        replace: true,
        state: { from },
      });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Unable to sign in right now.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await verifyMfa({ code: mfaCode, mfaToken });
      navigate(result.status === 'password_rotation_required' ? '/change-password' : from, {
        replace: true,
        state: { from },
      });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Unable to verify your code right now.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await authApi.requestPasswordReset({ identifier: resetIdentifier });
      setSuccessMessage(result.message);
      if (result.deliveryMode === 'email') {
        setView('reset');
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Unable to request a password reset right now.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    if (resetPassword !== resetConfirmPassword) {
      setErrorMessage('New password and confirmation do not match.');
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await authApi.confirmPasswordReset({
        code: resetCode,
        newPassword: resetPassword,
        token: resetToken,
      });
      setSuccessMessage(result.message);
      setView('signin');
      setPassword('');
      setResetCode('');
      setResetPassword('');
      setResetConfirmPassword('');
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Unable to reset password right now.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FCFBF8] text-[#2C2B29] flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-white border border-[#E6E4DD] rounded-2xl shadow-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#2C2B29] rounded-lg flex items-center justify-center">
            <Scale className="w-5 h-5 text-[#C19A5B]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[#8C8981] font-semibold">Global LMG</p>
            <h1
              className="text-2xl text-[#2C2B29]"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Admin Sign In
            </h1>
          </div>
        </div>

        <p className="text-sm text-[#8C8981] mb-6">
          {view === 'signin'
            ? 'Use your Global LMG admin credentials to continue.'
            : view === 'forgot'
              ? 'Enter your admin email or phone. If an account exists, reset instructions will be sent.'
              : view === 'mfa'
                ? 'Enter the code from your authenticator app to finish signing in.'
                : 'Enter the reset token, code, and a strong new password.'}
        </p>

        {errorMessage ? (
          <div className="mb-4 rounded-lg border border-[#F5C2C7] bg-[#FDE8EC] px-4 py-3 text-sm text-[#d4183d] flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {successMessage ? (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        ) : null}

        {view === 'signin' ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Email or phone</span>
              <input
                className="mt-2 w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 text-sm outline-none focus:border-[#C19A5B]"
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="you@example.com"
                required
                type="text"
                value={identifier}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Password</span>
              <div className="relative mt-2">
                <input
                  className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 pr-12 text-sm outline-none focus:border-[#C19A5B]"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8C8981] transition hover:bg-[#E6E4DD] hover:text-[#2C2B29]"
                  onClick={() => setShowPassword((current) => !current)}
                  type="button"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-[#5A7C96]">
                <input
                  checked={rememberMe}
                  className="rounded border-[#E6E4DD]"
                  onChange={(event) => setRememberMe(event.target.checked)}
                  type="checkbox"
                />
                Keep me signed in
              </label>
              <button
                className="text-sm font-medium text-[#5A7C96] underline-offset-4 hover:underline"
                onClick={() => {
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setView('forgot');
                }}
                type="button"
              >
                Forgot password?
              </button>
            </div>

            <button
              className="w-full rounded-lg bg-[#2C2B29] text-white py-3 text-sm font-medium hover:bg-[#4A4946] transition flex items-center justify-center gap-2 disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : null}

        {view === 'forgot' ? (
          <form className="space-y-4" onSubmit={handleForgotPasswordSubmit}>
            <button
              className="inline-flex items-center gap-2 text-sm text-[#5A7C96] hover:underline"
              onClick={() => {
                setErrorMessage(null);
                setSuccessMessage(null);
                setView('signin');
              }}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </button>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Admin email or phone</span>
              <input
                className="mt-2 w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 text-sm outline-none focus:border-[#C19A5B]"
                onChange={(event) => setResetIdentifier(event.target.value)}
                placeholder="you@example.com"
                required
                type="text"
                value={resetIdentifier}
              />
            </label>
            <button
              className="w-full rounded-lg bg-[#2C2B29] text-white py-3 text-sm font-medium hover:bg-[#4A4946] transition flex items-center justify-center gap-2 disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Requesting...' : 'Request reset'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : null}

        {view === 'mfa' ? (
          <form className="space-y-4" onSubmit={handleMfaSubmit}>
            <button
              className="inline-flex items-center gap-2 text-sm text-[#5A7C96] hover:underline"
              onClick={() => {
                setErrorMessage(null);
                setSuccessMessage(null);
                setMfaToken('');
                setMfaCode('');
                setView('signin');
              }}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </button>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Authenticator or recovery code</span>
              <div className="relative mt-2">
                <input
                  autoComplete="one-time-code"
                  className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 pr-12 text-sm tracking-[0.18em] outline-none focus:border-[#C19A5B]"
                  inputMode="numeric"
                  onChange={(event) => setMfaCode(event.target.value)}
                  placeholder="000000"
                  required
                  type="text"
                  value={mfaCode}
                />
                <KeyRound className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C8981]" />
              </div>
            </label>
            <button
              className="w-full rounded-lg bg-[#2C2B29] text-white py-3 text-sm font-medium hover:bg-[#4A4946] transition flex items-center justify-center gap-2 disabled:opacity-60"
              disabled={isSubmitting || !mfaToken}
              type="submit"
            >
              {isSubmitting ? 'Verifying...' : 'Verify & Sign In'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : null}

        {view === 'reset' ? (
          <form className="space-y-4" onSubmit={handleResetPasswordSubmit}>
            <button
              className="inline-flex items-center gap-2 text-sm text-[#5A7C96] hover:underline"
              onClick={() => {
                setErrorMessage(null);
                setSuccessMessage(null);
                setView('signin');
              }}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </button>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Reset token</span>
              <input
                className="mt-2 w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 text-sm outline-none focus:border-[#C19A5B]"
                onChange={(event) => setResetToken(event.target.value)}
                placeholder="Token from reset email"
                required
                type="text"
                value={resetToken}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Reset code</span>
              <input
                className="mt-2 w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 text-sm tracking-[0.2em] outline-none focus:border-[#C19A5B]"
                inputMode="numeric"
                onChange={(event) => setResetCode(event.target.value)}
                placeholder="000000"
                required
                type="text"
                value={resetCode}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">New password</span>
              <div className="relative mt-2">
                <input
                  className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 pr-12 text-sm outline-none focus:border-[#C19A5B]"
                  onChange={(event) => setResetPassword(event.target.value)}
                  placeholder="At least 12 characters"
                  required
                  type={showResetPassword ? 'text' : 'password'}
                  value={resetPassword}
                />
                <button
                  aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8C8981] transition hover:bg-[#E6E4DD] hover:text-[#2C2B29]"
                  onClick={() => setShowResetPassword((current) => !current)}
                  type="button"
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-[#2C2B29]">Confirm password</span>
              <div className="relative mt-2">
                <input
                  className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3 pr-12 text-sm outline-none focus:border-[#C19A5B]"
                  onChange={(event) => setResetConfirmPassword(event.target.value)}
                  placeholder="Repeat new password"
                  required
                  type={showResetConfirmPassword ? 'text' : 'password'}
                  value={resetConfirmPassword}
                />
                <button
                  aria-label={showResetConfirmPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#8C8981] transition hover:bg-[#E6E4DD] hover:text-[#2C2B29]"
                  onClick={() => setShowResetConfirmPassword((current) => !current)}
                  type="button"
                >
                  {showResetConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <button
              className="w-full rounded-lg bg-[#2C2B29] text-white py-3 text-sm font-medium hover:bg-[#4A4946] transition flex items-center justify-center gap-2 disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Resetting...' : 'Reset password'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
};
