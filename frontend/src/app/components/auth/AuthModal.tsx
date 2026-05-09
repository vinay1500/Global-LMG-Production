import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { BRAND_NAME } from '../../config/brand';
import { useAuth } from '../../contexts/useAuth';
import {
  isGoogleIdentityConfigured,
  loadGoogleIdentitySdk,
  mountGoogleIdentityButton,
} from '../../lib/googleIdentity';
import {
  applyCountryDialCode,
  COUNTRIES,
  DEFAULT_COUNTRY,
  detectCountryFromPhone,
  getCountryCode,
  getCountryDialCode,
} from '../../utils/countryDialCodes';
import {
  getPasswordStrengthErrors,
  isValidEmail,
  isValidFullName,
  isValidPhone,
  trimField,
} from '../../utils/authValidation';
import { AddressForm, createEmptyAddressValue, type AddressFormValue } from '../address/AddressForm';

type AuthView =
  | 'credentials'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-email'
  | 'phone-capture'
  | 'phone-otp';

type PendingVerificationView = Extract<AuthView, 'verify-email' | 'phone-capture' | 'phone-otp'>;

const PENDING_AUTH_STORAGE_KEY = 'glmg.pending-auth-verification';

type AlertState = {
  type: 'error' | 'success' | 'info';
  message: string;
} | null;

export const AuthModal = () => {
  const navigate = useNavigate();
  const {
    authMode,
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
  } = useAuth();

  // View state covers the full auth journey: credentials, recovery, and verification steps.
  const showPreviewSignInHint =
    import.meta.env.DEV && import.meta.env.VITE_PREVIEW_ACCOUNT_ENABLED === 'true';
  const [view, setView] = useState<AuthView>('credentials');
  const [alert, setAlert] = useState<AlertState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deliveryHint, setDeliveryHint] = useState<string | null>(null);
  const [pendingVerificationView, setPendingVerificationView] =
    useState<PendingVerificationView | null>(null);
  const [phoneOtpBackView, setPhoneOtpBackView] = useState<'credentials' | 'phone-capture'>(
    'phone-capture'
  );
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isGoogleButtonReady, setGoogleButtonReady] = useState(false);
  const [googleButtonError, setGoogleButtonError] = useState<string | null>(null);
  const [googleButtonHost, setGoogleButtonHost] = useState<HTMLDivElement | null>(null);
  const [signInForm, setSignInForm] = useState({
    identifier: '',
    password: '',
    rememberMe: true,
  });
  const [signUpForm, setSignUpForm] = useState({
    fullName: '',
    email: '',
    phone: applyCountryDialCode('', DEFAULT_COUNTRY),
    addressLine1: '',
    addressLine2: '',
    city: '',
    stateRegion: '',
    postalCode: '',
    addressSourceCode: 'manual' as AddressFormValue['sourceCode'],
    addressGooglePlaceId: null as string | null,
    addressValidationStatusCode: 'manual' as AddressFormValue['validationStatusCode'],
    password: '',
    confirmPassword: '',
    country: DEFAULT_COUNTRY,
    acceptTerms: false,
  });
  const [forgotPasswordIdentifier, setForgotPasswordIdentifier] = useState('');
  const [resetForm, setResetForm] = useState({
    email: '',
    code: '',
    password: '',
    confirmPassword: '',
  });
  const [verificationForm, setVerificationForm] = useState({
    emailCode: '',
    phone: applyCountryDialCode('', DEFAULT_COUNTRY),
    country: DEFAULT_COUNTRY,
    otp: '',
  });

  const passwordStrengthHints = useMemo(
    () =>
      getPasswordStrengthErrors(signUpForm.password, {
        email: signUpForm.email,
        name: signUpForm.fullName,
      }),
    [signUpForm.email, signUpForm.fullName, signUpForm.password]
  );
  const signUpAddressValue: AddressFormValue = {
    ...createEmptyAddressValue(signUpForm.country),
    city: signUpForm.city,
    country: signUpForm.country,
    googlePlaceId: signUpForm.addressGooglePlaceId,
    line1: signUpForm.addressLine1,
    line2: signUpForm.addressLine2,
    postalCode: signUpForm.postalCode,
    sourceCode: signUpForm.addressSourceCode,
    state: signUpForm.stateRegion,
    validationStatusCode: signUpForm.addressValidationStatusCode,
  };

  const persistPendingAuthState = useCallback(
    (
      nextPendingVerificationView: PendingVerificationView | null,
      options?: {
        authMode?: 'signin' | 'signup';
        deliveryHint?: string | null;
        phoneOtpBackView?: 'credentials' | 'phone-capture';
        verificationForm?: typeof verificationForm;
      }
    ) => {
      if (typeof window === 'undefined') {
        return;
      }

      if (!nextPendingVerificationView) {
        window.sessionStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
        return;
      }

      window.sessionStorage.setItem(
        PENDING_AUTH_STORAGE_KEY,
        JSON.stringify({
          authMode: options?.authMode ?? authMode,
          deliveryHint: typeof options?.deliveryHint === 'undefined' ? deliveryHint : options.deliveryHint,
          pendingVerificationView: nextPendingVerificationView,
          phoneOtpBackView: options?.phoneOtpBackView ?? phoneOtpBackView,
          verificationForm: options?.verificationForm ?? verificationForm,
        })
      );
    },
    [authMode, deliveryHint, phoneOtpBackView, verificationForm]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const rawState = window.sessionStorage.getItem(PENDING_AUTH_STORAGE_KEY);

    if (!rawState) {
      return;
    }

    try {
      const parsed = JSON.parse(rawState) as {
        authMode?: 'signin' | 'signup';
        deliveryHint?: string | null;
        pendingVerificationView?: PendingVerificationView;
        phoneOtpBackView?: 'credentials' | 'phone-capture';
        verificationForm?: Partial<typeof verificationForm>;
      };

      if (parsed.pendingVerificationView) {
        setPendingVerificationView(parsed.pendingVerificationView);
      }

      if (parsed.phoneOtpBackView) {
        setPhoneOtpBackView(parsed.phoneOtpBackView);
      }

      if (parsed.authMode) {
        setAuthMode(parsed.authMode);
      }

      if (typeof parsed.deliveryHint !== 'undefined') {
        setDeliveryHint(parsed.deliveryHint);
      }

      if (parsed.verificationForm) {
        setVerificationForm((current) => ({
          ...current,
          ...parsed.verificationForm,
        }));
      }
    } catch {
      window.sessionStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
    }
  }, [setAuthMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || pendingVerificationView || view !== 'credentials') {
      return;
    }

    const rawState = window.sessionStorage.getItem(PENDING_AUTH_STORAGE_KEY);
    if (!rawState) {
      return;
    }

    try {
      const parsed = JSON.parse(rawState) as {
        authMode?: 'signin' | 'signup';
        pendingVerificationView?: PendingVerificationView;
        phoneOtpBackView?: 'credentials' | 'phone-capture';
        deliveryHint?: string | null;
        verificationForm?: Partial<typeof verificationForm>;
      };

      if (!parsed.pendingVerificationView) {
        return;
      }

      setPendingVerificationView(parsed.pendingVerificationView);
      setPhoneOtpBackView(parsed.phoneOtpBackView ?? 'phone-capture');
      if (parsed.authMode) {
        setAuthMode(parsed.authMode);
      }
      if (typeof parsed.deliveryHint !== 'undefined') {
        setDeliveryHint(parsed.deliveryHint);
      }
      if (parsed.verificationForm) {
        setVerificationForm((current) => ({ ...current, ...parsed.verificationForm }));
      }
    } catch {
      window.sessionStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
    }
  }, [pendingVerificationView, setAuthMode, view]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!pendingVerificationView) {
      window.sessionStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
      return;
    }

    window.sessionStorage.setItem(
      PENDING_AUTH_STORAGE_KEY,
      JSON.stringify({
        authMode,
        deliveryHint,
        pendingVerificationView,
        phoneOtpBackView,
        verificationForm,
      })
    );
  }, [authMode, deliveryHint, pendingVerificationView, phoneOtpBackView, verificationForm]);

  useEffect(() => {
    if (!isGoogleIdentityConfigured) {
      return;
    }

    void loadGoogleIdentitySdk().catch(() => undefined);
  }, []);

  // Shared field styles keep the glassmorphism forms visually consistent across every step.
  const glassFieldClass =
    'w-full rounded-2xl border border-white/15 bg-slate-950/45 px-4 py-3 text-sm text-white outline-none placeholder:text-white/50';
  const glassFieldGroupClass =
    'flex items-center gap-3 rounded-2xl border border-white/15 bg-slate-950/45 px-4 py-3';

  const clearFeedback = useCallback(() => {
    setAlert(null);
    setFieldErrors({});
    setDeliveryHint(null);
  }, []);

  const clearPendingVerification = useCallback(() => {
    setPendingVerificationView(null);
    setPhoneOtpBackView('phone-capture');
    persistPendingAuthState(null);
  }, [persistPendingAuthState]);

  const openPendingVerificationView = useCallback(
    (
      nextView: PendingVerificationView,
      options?: { phoneOtpBackView?: 'credentials' | 'phone-capture' }
    ) => {
      setPendingVerificationView(nextView);
      if (nextView === 'phone-otp') {
        setPhoneOtpBackView(options?.phoneOtpBackView ?? 'credentials');
      }
      persistPendingAuthState(nextView, {
        phoneOtpBackView:
          nextView === 'phone-otp' ? options?.phoneOtpBackView ?? 'credentials' : phoneOtpBackView,
      });
      setView(nextView);
    },
    [persistPendingAuthState, phoneOtpBackView]
  );

  const buildAlertMessage = useCallback((message: string, nextDeliveryHint?: string) => {
    return nextDeliveryHint ? `${message} ${nextDeliveryHint}` : message;
  }, []);

  const handleVerificationCountryChange = (country: string) => {
    setVerificationForm((current) => ({
      ...current,
      country,
      phone: applyCountryDialCode(current.phone, country),
    }));
  };

  // Core validation helpers return field-level errors so every step can render inline feedback.
  const handleClose = () => {
    clearFeedback();
    clearPendingVerification();
    closeAuthModal();
  };

  const validateSignIn = () => {
    const nextErrors: Record<string, string> = {};
    const identifier = signInForm.identifier.trim();

    if (!identifier) {
      nextErrors.identifier = 'Email or phone is required.';
    } else if (!identifier.includes('@') && !isValidPhone(identifier)) {
      nextErrors.identifier = 'Enter a valid email address or phone number.';
    } else if (identifier.includes('@') && !isValidEmail(identifier)) {
      nextErrors.identifier = 'Enter a valid email address.';
    }

    if (!signInForm.password.trim()) {
      nextErrors.password = 'Password is required.';
    }

    return nextErrors;
  };

  const validateSignUp = () => {
    const nextErrors: Record<string, string> = {};

    if (!isValidFullName(signUpForm.fullName)) {
      nextErrors.fullName =
        'Enter your full name using letters from your language and valid punctuation only.';
    }
    if (!isValidEmail(signUpForm.email)) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (!isValidPhone(signUpForm.phone)) {
      nextErrors.phone = 'Enter a valid phone number with country code where possible.';
    }
    if (!signUpForm.country.trim()) {
      nextErrors.country = 'Country is required.';
    }
    if (trimField(signUpForm.addressLine1).length < 3) {
      nextErrors.addressLine1 = 'Address line 1 is required.';
    }
    if (trimField(signUpForm.city).length < 2) {
      nextErrors.city = 'City is required.';
    }
    if (trimField(signUpForm.stateRegion).length < 2) {
      nextErrors.stateRegion = 'State or region is required.';
    }
    if (trimField(signUpForm.postalCode).length < 3) {
      nextErrors.postalCode = 'Postal code is required.';
    }

    const passwordErrors = getPasswordStrengthErrors(signUpForm.password, {
      email: signUpForm.email,
      name: signUpForm.fullName,
    });
    if (passwordErrors.length > 0) {
      nextErrors.password = passwordErrors[0];
    }
    if (signUpForm.confirmPassword !== signUpForm.password) {
      nextErrors.confirmPassword = 'Confirm password must match the password.';
    }
    if (!signUpForm.acceptTerms) {
      nextErrors.acceptTerms =
        'You must accept the Terms, Refund and Cancellation Policy, Legal Disclaimer, and Privacy Policy.';
    }

    return nextErrors;
  };

  const validateForgotPassword = () => {
    const nextErrors: Record<string, string> = {};
    if (!forgotPasswordIdentifier.trim()) {
      nextErrors.forgotPasswordIdentifier = 'Email or phone is required.';
    }
    return nextErrors;
  };

  const validateResetPassword = () => {
    const nextErrors: Record<string, string> = {};
    if (!isValidEmail(resetForm.email)) {
      nextErrors.resetEmail = 'Enter the account email address.';
    }
    if (resetForm.code.trim().length !== 6) {
      nextErrors.resetCode = 'Enter the 6-digit reset code.';
    }
    const passwordErrors = getPasswordStrengthErrors(resetForm.password, {
      email: resetForm.email,
    });
    if (passwordErrors.length > 0) {
      nextErrors.resetPassword = passwordErrors[0];
    }
    if (resetForm.confirmPassword !== resetForm.password) {
      nextErrors.resetConfirmPassword = 'Confirm password must match the password.';
    }
    return nextErrors;
  };

  const validateEmailCode = () => {
    if (verificationForm.emailCode.trim().length !== 6) {
      return { emailCode: 'Enter the 6-digit email verification code.' };
    }

    return {} as Record<string, string>;
  };

  const validatePhoneCapture = () => {
    const nextErrors: Record<string, string> = {};
    if (!verificationForm.country.trim()) {
      nextErrors.googleCountry = 'Country is required.';
    }
    if (!isValidPhone(verificationForm.phone)) {
      nextErrors.googlePhone = 'Enter a valid phone number.';
    }
    return nextErrors;
  };

  const validatePhoneOtp = () => {
    if (verificationForm.otp.trim().length !== 6) {
      return { otp: 'Enter the 6-digit verification code.' };
    }

    return {} as Record<string, string>;
  };

  const handleAuthSuccess = useCallback((message: string) => {
    clearPendingVerification();
    setAlert({ type: 'success', message });
    navigate('/dashboard');
  }, [clearPendingVerification, navigate]);

  const mapAuthError = useCallback((error: unknown) => {
    if (!error || typeof error !== 'object' || !('code' in error)) {
      return 'Something went wrong. Please try again.';
    }

    const authError = error as unknown as Error & { code: string };
    const code = String(authError.code);
    switch (code) {
      case 'EMAIL_ALREADY_EXISTS':
      case 'email_already_exists':
        return 'This email already exists. Try signing in or use a different email.';
      case 'PHONE_ALREADY_EXISTS':
      case 'phone_already_exists':
        return 'This phone number is already registered.';
      case 'INVALID_CREDENTIALS':
      case 'invalid_credentials':
        return 'Invalid credentials. Check your email or phone and password.';
      case 'ACCOUNT_NOT_FOUND':
      case 'account_not_found':
        return 'No account was found for those details.';
      case 'ACCOUNT_NOT_VERIFIED':
        return 'Your account is not verified yet.';
      case 'TOO_MANY_ATTEMPTS':
      case 'too_many_attempts':
        return 'Too many attempts. Please wait and try again.';
      case 'USE_GOOGLE_SIGN_IN':
      case 'use_google_sign_in':
        return 'This account uses Google sign-in. Continue with Google instead.';
      case 'INVALID_EMAIL_VERIFICATION_CODE':
      case 'invalid_email_verification_code':
        return 'That email verification code is not valid.';
      case 'INVALID_PHONE_OTP':
      case 'invalid_phone_otp':
        return 'That verification code is not valid.';
      case 'INVALID_RESET_CODE':
      case 'invalid_reset_code':
        return 'That reset code is invalid or expired.';
      case 'RESET_EMAIL_MISMATCH':
      case 'reset_email_mismatch':
        return 'The reset email does not match the account that requested a reset.';
      case 'csrf_mismatch':
      case 'csrf_invalid':
        return 'Your session security token expired. Please try again.';
      case 'missing_auth_flow':
      case 'invalid_auth_flow':
      case 'expired_verification_step':
        return 'That verification step expired. Start the flow again.';
      case 'google_sign_in_disabled':
        return 'Google sign-in is not available right now.';
      case 'google_nonce_required':
      case 'google_nonce_invalid':
      case 'google_nonce_missing':
      case 'google_nonce_mismatch':
        return 'Google sign-in expired. Please try again.';
      default:
        return authError.message || 'Something went wrong. Please try again.';
      }
  }, []);

  const handleGoogleAuthResult = useCallback(
    (result: Awaited<ReturnType<typeof signInWithGoogle>>) => {
      if (result.status === 'authenticated') {
        setDeliveryHint(null);
        handleAuthSuccess(result.message);
        return;
      }

      if (result.status === 'phone_capture_required') {
        openPendingVerificationView('phone-capture');
        setVerificationForm((current) => ({
          ...current,
          phone: result.phone || applyCountryDialCode('', DEFAULT_COUNTRY),
          country: detectCountryFromPhone(result.phone || '', DEFAULT_COUNTRY),
        }));
        setDeliveryHint(result.deliveryHint || null);
        setAlert({
          type: 'info',
          message:
            'Google returned a verified email, but we still need your phone number for secure phone verification.',
        });
        return;
      }

      if (result.status === 'phone_otp_required') {
        openPendingVerificationView('phone-otp', { phoneOtpBackView: 'phone-capture' });
        setVerificationForm((current) => ({
          ...current,
          phone: result.phone || current.phone,
          country: detectCountryFromPhone(result.phone || current.phone, current.country),
        }));
        setDeliveryHint(result.deliveryHint || null);
        setAlert({ type: 'info', message: buildAlertMessage(result.message, result.deliveryHint) });
      }
    },
    [buildAlertMessage, handleAuthSuccess, openPendingVerificationView]
  );

  useEffect(() => {
    if (view !== 'credentials' || !isGoogleIdentityConfigured) {
      setGoogleButtonReady(false);
      setGoogleButtonError(
        isGoogleIdentityConfigured ? null : 'Google sign-in is not available right now.'
      );
      return;
    }

    const mountNode = googleButtonHost;
    if (!mountNode) {
      setGoogleButtonReady(false);
      setGoogleButtonError('Google sign-in button could not be initialized.');
      return;
    }

    let disposed = false;
    let cleanup: (() => void) | undefined;
    setGoogleButtonReady(false);
    setGoogleButtonError(null);

    void issueGoogleNonce()
      .then((nonceResult) =>
        mountGoogleIdentityButton(mountNode, {
          nonce: nonceResult.nonce,
          width: mountNode.clientWidth,
          onCredential: async (credential) => {
            clearFeedback();
            setIsSubmitting(true);

            try {
              const result = await signInWithGoogle({
                credential,
                nonce: nonceResult.nonce,
                rememberMe: signInForm.rememberMe,
              });
              handleGoogleAuthResult(result);
            } catch (error) {
              setAlert({
                type: 'error',
                message:
                  error instanceof Error && !('code' in error)
                    ? error.message
                    : mapAuthError(error),
              });
            } finally {
              setIsSubmitting(false);
            }
          },
          onError: (error) => {
            setAlert({ type: 'error', message: error.message });
          },
        })
      )
      .then((nextCleanup) => {
        if (disposed) {
          nextCleanup();
          return;
        }

        cleanup = nextCleanup;
        setGoogleButtonReady(true);
        setGoogleButtonError(null);
      })
      .catch((error) => {
        if (!disposed) {
          setGoogleButtonReady(false);
          setGoogleButtonError(
            error instanceof Error ? error.message : 'Google sign-in is unavailable right now.'
          );
          setAlert({
            type: 'error',
            message: error instanceof Error ? error.message : 'Google sign-in is unavailable right now.',
          });
        }
      });

    return () => {
      disposed = true;
      setGoogleButtonReady(false);
      cleanup?.();
    };
  }, [
    clearFeedback,
    googleButtonHost,
    handleGoogleAuthResult,
    issueGoogleNonce,
    mapAuthError,
    signInForm.rememberMe,
    signInWithGoogle,
    view,
  ]);

  // Submission handlers stay close to the component because each step controls both UI flow and API-driven auth transitions.
  const handleSignInSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validateSignIn();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signIn({
        identifier: trimField(signInForm.identifier),
        password: signInForm.password,
        rememberMe: signInForm.rememberMe,
      });

      if (result.status === 'authenticated') {
        setDeliveryHint(null);
        handleAuthSuccess(result.message);
        return;
      }

      if (result.status === 'email_verification_required') {
        openPendingVerificationView('verify-email');
        setDeliveryHint(result.deliveryHint || null);
        setAlert({ type: 'info', message: buildAlertMessage(result.message, result.deliveryHint) });
        return;
      }

      if (result.status === 'phone_otp_required') {
        openPendingVerificationView('phone-otp', { phoneOtpBackView: 'phone-capture' });
        setVerificationForm((current) => ({
          ...current,
          phone: result.phone || current.phone,
          country: detectCountryFromPhone(result.phone || current.phone, current.country),
        }));
        setDeliveryHint(result.deliveryHint || null);
        setAlert({ type: 'info', message: buildAlertMessage(result.message, result.deliveryHint) });
      }
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validateSignUp();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signUp({
        fullName: trimField(signUpForm.fullName),
        email: trimField(signUpForm.email),
        phone: trimField(signUpForm.phone),
        password: signUpForm.password,
        country: getCountryCode(signUpForm.country) || signUpForm.country,
        address: {
          city: trimField(signUpForm.city),
          country: getCountryCode(signUpForm.country) || signUpForm.country,
          line1: trimField(signUpForm.addressLine1),
          line2: trimField(signUpForm.addressLine2),
          postalCode: trimField(signUpForm.postalCode),
          sourceCode: signUpForm.addressSourceCode,
          state: trimField(signUpForm.stateRegion),
          googlePlaceId: signUpForm.addressGooglePlaceId,
          validationStatusCode: signUpForm.addressValidationStatusCode,
        },
        acceptTerms: signUpForm.acceptTerms,
      });

      openPendingVerificationView('verify-email');
      setVerificationForm((current) => ({ ...current, phone: trimField(signUpForm.phone), country: signUpForm.country }));
      setDeliveryHint(result.deliveryHint || null);
      setAlert({
        type: 'success',
        message: buildAlertMessage(result.message, result.deliveryHint),
      });
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailVerificationSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validateEmailCode();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyEmail({ code: verificationForm.emailCode });
      openPendingVerificationView('phone-otp', { phoneOtpBackView: 'phone-capture' });
      setVerificationForm((current) => ({
        ...current,
        phone: result.phone || current.phone,
        country: detectCountryFromPhone(result.phone || current.phone, current.country),
      }));
      setDeliveryHint(result.deliveryHint || null);
      setAlert({ type: 'success', message: buildAlertMessage(result.message, result.deliveryHint) });
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneCaptureSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validatePhoneCapture();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitGooglePhone({
        phone: trimField(verificationForm.phone),
        country: getCountryCode(verificationForm.country) || verificationForm.country,
      });
      openPendingVerificationView('phone-otp', { phoneOtpBackView: 'phone-capture' });
      setDeliveryHint(result.deliveryHint || null);
      setAlert({ type: 'success', message: buildAlertMessage(result.message, result.deliveryHint) });
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validatePhoneOtp();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await verifyPhoneOtp({ code: verificationForm.otp });
      setDeliveryHint(null);
      handleAuthSuccess(result.message);
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validateForgotPassword();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const requestedIdentifier = trimField(forgotPasswordIdentifier);
      const result = await requestPasswordReset({
        identifier: requestedIdentifier,
      });
      clearPendingVerification();
      setResetForm((current) => ({
        ...current,
        email: requestedIdentifier.includes('@') ? requestedIdentifier : '',
        code: '',
      }));
      setView('reset-password');
      setDeliveryHint(null);
      setAlert({
        type: 'success',
        message: result.message,
      });
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearFeedback();
    const nextErrors = validateResetPassword();
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await resetPassword({
        email: trimField(resetForm.email),
        code: resetForm.code,
        password: resetForm.password,
      });
      clearPendingVerification();
      setAuthMode('signin');
      setView('credentials');
      setSignInForm((current) => ({ ...current, identifier: trimField(resetForm.email), password: '' }));
      setDeliveryHint(null);
      setAlert({ type: 'success', message: result.message });
    } catch (error) {
      setAlert({ type: 'error', message: mapAuthError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Each renderer below focuses on one step of the auth journey so the modal shell stays readable.
  const renderCredentialsView = () => (
    <>
      <div className="mb-6 grid grid-cols-2 rounded-full border border-white/15 bg-slate-950/45 p-1">
        {[
          { id: 'signin', label: 'Sign In' },
          { id: 'signup', label: 'Sign Up' },
        ].map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              clearFeedback();
              setAuthMode(option.id as 'signin' | 'signup');
            }}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              authMode === option.id
                ? 'bg-white text-black shadow-lg shadow-black/10'
                : 'text-white/75 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        onClick={() => {
          if (!isGoogleButtonReady) {
            setAlert({
              type: 'error',
              message:
                googleButtonError ||
                'Google sign-in is still loading or unavailable right now. Refresh the page and try again.',
            });
          }
        }}
        className={`relative mb-5 w-full overflow-hidden rounded-2xl border border-white/15 bg-slate-950/45 text-sm font-semibold text-white transition ${
          isSubmitting ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-900/60'
        }`}
      >
        <span className="pointer-events-none inline-flex w-full items-center justify-center gap-3 px-4 py-3">
          {isSubmitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Continue with Google
        </span>
        <div
          ref={setGoogleButtonHost}
          aria-hidden="true"
          className={`absolute inset-0 overflow-hidden rounded-2xl opacity-0 ${
            isSubmitting ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
        />
      </div>

      {pendingVerificationView && (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-amber-200/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
          <span>
            {pendingVerificationView === 'verify-email'
              ? 'Email verification is still pending.'
              : pendingVerificationView === 'phone-capture'
                ? 'Phone number confirmation is still pending.'
                : 'Phone verification is still pending. You can update the phone number if delivery failed.'}
          </span>
          <div className="flex items-center gap-2">
            {pendingVerificationView === 'phone-otp' && (
              <button
                type="button"
                onClick={() => {
                  clearFeedback();
                  setVerificationForm((current) => ({ ...current, otp: '' }));
                  setView('phone-capture');
                }}
                className="whitespace-nowrap rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/10"
              >
                Change Phone
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setView(pendingVerificationView);
              }}
              className="whitespace-nowrap rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/10"
            >
              Resume
            </button>
          </div>
        </div>
      )}

      <div className="mb-5 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/55">
        <span className="h-px flex-1 bg-white/15" />
        Or continue with email
        <span className="h-px flex-1 bg-white/15" />
      </div>

      {authMode === 'signin' ? (
        <form className="space-y-4" onSubmit={handleSignInSubmit} noValidate>
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
              Email or Phone
            </span>
            <span className={glassFieldGroupClass}>
              <Mail className="h-4 w-4 text-white/55" />
              <input
                type="text"
                value={signInForm.identifier}
                onChange={(event) =>
                  setSignInForm((current) => ({ ...current, identifier: event.target.value }))
                }
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                placeholder="name@example.com or +country code..."
                aria-invalid={Boolean(fieldErrors.identifier)}
                aria-describedby={fieldErrors.identifier ? 'signin-identifier-error' : undefined}
              />
            </span>
            {fieldErrors.identifier && (
              <p id="signin-identifier-error" className="mt-2 text-sm text-rose-200">
                {fieldErrors.identifier}
              </p>
            )}
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
              Password
            </span>
            <span className={glassFieldGroupClass}>
              <LockKeyhole className="h-4 w-4 text-white/55" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={signInForm.password}
                onChange={(event) =>
                  setSignInForm((current) => ({ ...current, password: event.target.value }))
                }
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                placeholder="Enter your password"
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'signin-password-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="text-white/60 transition hover:text-white"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
            {fieldErrors.password && (
              <p id="signin-password-error" className="mt-2 text-sm text-rose-200">
                {fieldErrors.password}
              </p>
            )}
          </label>

          <div className="flex items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-white/85">
              <input
                type="checkbox"
                checked={signInForm.rememberMe}
                onChange={(event) =>
                  setSignInForm((current) => ({ ...current, rememberMe: event.target.checked }))
                }
                className="h-4 w-4 rounded border-white/30 bg-white/10 text-black focus:ring-white/30"
              />
              Remember me
            </label>
            <button
              type="button"
              onClick={() => {
                clearFeedback();
                clearPendingVerification();
                setView('forgot-password');
              }}
              className="text-sm text-white/90 underline-offset-4 transition hover:text-white hover:underline"
            >
              Forgot password?
            </button>
          </div>

          {showPreviewSignInHint && (
            <div className="rounded-2xl border border-sky-200/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-50">
              Preview sign-in is enabled for this local build. Use the configured preview
              credentials.
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Sign In
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleSignUpSubmit} noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
                Full Name
              </span>
              <span className={glassFieldGroupClass}>
                <User className="h-4 w-4 text-white/55" />
                <input
                  type="text"
                  value={signUpForm.fullName}
                  onChange={(event) =>
                    setSignUpForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                  placeholder="Enter your full name"
                  aria-invalid={Boolean(fieldErrors.fullName)}
                />
              </span>
              {fieldErrors.fullName && <p className="mt-2 text-sm text-rose-200">{fieldErrors.fullName}</p>}
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
                Email
              </span>
              <span className={glassFieldGroupClass}>
                <Mail className="h-4 w-4 text-white/55" />
                <input
                  type="email"
                  value={signUpForm.email}
                  onChange={(event) =>
                    setSignUpForm((current) => ({ ...current, email: event.target.value }))
                  }
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                  placeholder="name@example.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                />
              </span>
              {fieldErrors.email && <p className="mt-2 text-sm text-rose-200">{fieldErrors.email}</p>}
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
                Phone Number
              </span>
              <span className={glassFieldGroupClass}>
                <Phone className="h-4 w-4 text-white/55" />
                <input
                  type="tel"
                  value={signUpForm.phone}
                  onChange={(event) =>
                    setSignUpForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                  placeholder={`${getCountryDialCode(signUpForm.country)} 98765 43210`}
                  aria-invalid={Boolean(fieldErrors.phone)}
                />
              </span>
              <p className="mt-2 text-xs text-white/55">
                Country code follows your selected country automatically.
              </p>
              {fieldErrors.phone && <p className="mt-2 text-sm text-rose-200">{fieldErrors.phone}</p>}
            </label>

            <div className="md:col-span-2">
              <AddressForm
                idPrefix="signup-address"
                value={signUpAddressValue}
                variant="glass"
                onChange={(address) => {
                  setSignUpForm((current) => ({
                    ...current,
                    addressGooglePlaceId: address.googlePlaceId || null,
                    addressLine1: address.line1,
                    addressLine2: address.line2,
                    addressSourceCode: address.sourceCode,
                    addressValidationStatusCode: address.validationStatusCode,
                    city: address.city,
                    country: address.country,
                    phone:
                      address.country !== current.country
                        ? applyCountryDialCode(current.phone, address.country)
                        : current.phone,
                    postalCode: address.postalCode,
                    stateRegion: address.state,
                  }));
                }}
              />
              {fieldErrors.country && <p className="mt-2 text-sm text-rose-200">{fieldErrors.country}</p>}
              {fieldErrors.addressLine1 && <p className="mt-2 text-sm text-rose-200">{fieldErrors.addressLine1}</p>}
              {fieldErrors.city && <p className="mt-2 text-sm text-rose-200">{fieldErrors.city}</p>}
              {fieldErrors.stateRegion && <p className="mt-2 text-sm text-rose-200">{fieldErrors.stateRegion}</p>}
              {fieldErrors.postalCode && <p className="mt-2 text-sm text-rose-200">{fieldErrors.postalCode}</p>}
            </div>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
                Password
              </span>
              <span className={glassFieldGroupClass}>
                <LockKeyhole className="h-4 w-4 text-white/55" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={signUpForm.password}
                  onChange={(event) =>
                    setSignUpForm((current) => ({ ...current, password: event.target.value }))
                  }
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                  placeholder="Create a strong password"
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="text-white/60 transition hover:text-white"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              {fieldErrors.password && <p className="mt-2 text-sm text-rose-200">{fieldErrors.password}</p>}
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
                Confirm Password
              </span>
              <span className={glassFieldGroupClass}>
                <LockKeyhole className="h-4 w-4 text-white/55" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={signUpForm.confirmPassword}
                  onChange={(event) =>
                    setSignUpForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/45"
                  placeholder="Repeat your password"
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  className="text-white/60 transition hover:text-white"
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              {fieldErrors.confirmPassword && (
                <p className="mt-2 text-sm text-rose-200">{fieldErrors.confirmPassword}</p>
              )}
            </label>
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/20 px-4 py-3 text-sm text-white/85">
            Required fields: full name, email, phone number, billing address, password,
            confirm password, and the legal review checkbox.
            <br />
            Your saved address is used for pricing country, billing, and invoice tax handling.
            {passwordStrengthHints.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-white/70">
                {passwordStrengthHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            )}
          </div>

          <label className="inline-flex items-start gap-3 text-sm text-white/85">
            <input
              type="checkbox"
              checked={signUpForm.acceptTerms}
              onChange={(event) =>
                setSignUpForm((current) => ({ ...current, acceptTerms: event.target.checked }))
              }
              className="mt-1 h-4 w-4 rounded border-white/30 bg-white/10 text-black focus:ring-white/30"
            />
          <span>
              I agree to the{' '}
              <Link to="/terms" className="underline underline-offset-4" onClick={handleClose}>
                Terms
              </Link>
              ,{' '}
              <Link
                to="/refund-cancellation"
                className="underline underline-offset-4"
                onClick={handleClose}
              >
                Refund and Cancellation Policy
              </Link>
              ,{' '}
              <Link to="/legal-disclaimer" className="underline underline-offset-4" onClick={handleClose}>
                Legal Disclaimer
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="underline underline-offset-4" onClick={handleClose}>
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {fieldErrors.acceptTerms && <p className="text-sm text-rose-200">{fieldErrors.acceptTerms}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Create Account
          </button>
        </form>
      )}
    </>
  );

  const renderForgotPasswordView = () => (
    <form className="space-y-4" onSubmit={handleForgotPasswordSubmit} noValidate>
      <button
        type="button"
        onClick={() => {
          clearFeedback();
          clearPendingVerification();
          setView('credentials');
        }}
        className="inline-flex items-center gap-2 text-sm text-white/85 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </button>
      <p className="text-sm text-white/75">
        Enter your email or phone number. If an account exists, password reset instructions will
        be sent securely.
      </p>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Email or Phone
        </span>
        <input
          type="text"
          value={forgotPasswordIdentifier}
          onChange={(event) => setForgotPasswordIdentifier(event.target.value)}
          className={glassFieldClass}
          placeholder="name@example.com or +country code..."
        />
      </label>
      {fieldErrors.forgotPasswordIdentifier && (
        <p className="text-sm text-rose-200">{fieldErrors.forgotPasswordIdentifier}</p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Send Reset Code
      </button>
    </form>
  );

  const renderResetPasswordView = () => (
    <form className="space-y-4" onSubmit={handleResetPasswordSubmit} noValidate>
      <button
        type="button"
        onClick={() => {
          clearFeedback();
          clearPendingVerification();
          setView('credentials');
          setAuthMode('signin');
        }}
        className="inline-flex items-center gap-2 text-sm text-white/85 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to sign in
      </button>

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Account Email
        </span>
        <input
          type="email"
          value={resetForm.email}
          onChange={(event) => setResetForm((current) => ({ ...current, email: event.target.value }))}
          className={glassFieldClass}
          placeholder="name@example.com"
        />
      </label>
      {fieldErrors.resetEmail && <p className="text-sm text-rose-200">{fieldErrors.resetEmail}</p>}

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Reset Code
        </span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={resetForm.code}
          onChange={(event) => setResetForm((current) => ({ ...current, code: event.target.value }))}
          className={`${glassFieldClass} tracking-[0.3em]`}
          placeholder="000000"
        />
      </label>
      {fieldErrors.resetCode && <p className="text-sm text-rose-200">{fieldErrors.resetCode}</p>}

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          New Password
        </span>
        <input
          type={showPassword ? 'text' : 'password'}
          value={resetForm.password}
          onChange={(event) =>
            setResetForm((current) => ({ ...current, password: event.target.value }))
          }
          className={glassFieldClass}
          placeholder="Create a new password"
        />
      </label>
      {fieldErrors.resetPassword && <p className="text-sm text-rose-200">{fieldErrors.resetPassword}</p>}

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Confirm Password
        </span>
        <input
          type={showConfirmPassword ? 'text' : 'password'}
          value={resetForm.confirmPassword}
          onChange={(event) =>
            setResetForm((current) => ({ ...current, confirmPassword: event.target.value }))
          }
          className={glassFieldClass}
          placeholder="Repeat your new password"
        />
      </label>
      {fieldErrors.resetConfirmPassword && (
        <p className="text-sm text-rose-200">{fieldErrors.resetConfirmPassword}</p>
      )}

      <div className="flex items-center justify-between text-sm text-white/75">
        <span>
          {deliveryHint ||
            'If an account exists, use the code sent to the verified email address.'}
        </span>
        <button
          type="button"
          onClick={async () => {
            setIsSubmitting(true);
            try {
              const result = await resendPasswordReset();
              setDeliveryHint(result.deliveryHint || null);
              setAlert({
                type: 'info',
                message: buildAlertMessage(result.message, result.deliveryHint),
              });
            } catch (error) {
              setAlert({ type: 'error', message: mapAuthError(error) });
            } finally {
              setIsSubmitting(false);
            }
          }}
          className="underline underline-offset-4"
        >
          Resend
        </button>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Reset Password
      </button>
    </form>
  );

  const renderVerifyEmailView = () => (
    <form className="space-y-4" onSubmit={handleEmailVerificationSubmit} noValidate>
      <button
        type="button"
        onClick={() => {
          clearFeedback();
          setView('credentials');
        }}
        className="inline-flex items-center gap-2 text-sm text-white/85 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="rounded-2xl border border-emerald-200/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">
        {deliveryHint ||
          'Email verification is mandatory before first login. Check your inbox for the verification code.'}
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Verification Code
        </span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={verificationForm.emailCode}
          onChange={(event) =>
            setVerificationForm((current) => ({ ...current, emailCode: event.target.value }))
          }
          className={`${glassFieldClass} tracking-[0.3em]`}
          placeholder="000000"
        />
      </label>
      {fieldErrors.emailCode && <p className="text-sm text-rose-200">{fieldErrors.emailCode}</p>}
      <div className="flex items-center justify-between text-sm text-white/75">
        <span>Verification email sent.</span>
        <button
          type="button"
          onClick={async () => {
            setIsSubmitting(true);
            try {
              const result = await resendEmailVerification();
              setDeliveryHint(result.deliveryHint || null);
              setAlert({
                type: 'info',
                message: buildAlertMessage(result.message, result.deliveryHint),
              });
            } catch (error) {
              setAlert({ type: 'error', message: mapAuthError(error) });
            } finally {
              setIsSubmitting(false);
            }
          }}
          className="underline underline-offset-4"
        >
          Resend email
        </button>
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Verify Email
      </button>
    </form>
  );

  const renderPhoneCaptureView = () => (
    <form className="space-y-4" onSubmit={handlePhoneCaptureSubmit} noValidate>
      <button
        type="button"
        onClick={() => {
          clearFeedback();
          setView('credentials');
        }}
        className="inline-flex items-center gap-2 text-sm text-white/85 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <p className="text-sm text-white/75">
        Confirm or update your phone number so we can send a fresh verification code before dashboard access.
      </p>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Country
        </span>
        <select
          value={verificationForm.country}
          onChange={(event) => handleVerificationCountryChange(event.target.value)}
          className={glassFieldClass}
        >
          {COUNTRIES.map((country) => (
            <option key={country} value={country}>
              {country}
            </option>
          ))}
        </select>
      </label>
      {fieldErrors.googleCountry && <p className="text-sm text-rose-200">{fieldErrors.googleCountry}</p>}

      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Phone Number
        </span>
        <input
          type="tel"
          value={verificationForm.phone}
          onChange={(event) =>
            setVerificationForm((current) => ({ ...current, phone: event.target.value }))
          }
          className={glassFieldClass}
          placeholder={`${getCountryDialCode(verificationForm.country)} 98765 43210`}
        />
      </label>
      {fieldErrors.googlePhone && <p className="text-sm text-rose-200">{fieldErrors.googlePhone}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Send Code
      </button>
    </form>
  );

  const renderPhoneOtpView = () => (
    <form className="space-y-4" onSubmit={handlePhoneOtpSubmit} noValidate>
      <button
        type="button"
        onClick={() => {
          clearFeedback();
          setView(phoneOtpBackView);
        }}
        className="inline-flex items-center gap-2 text-sm text-white/85 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="rounded-2xl border border-amber-200/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
        {deliveryHint ||
          'Phone verification is required for client access. Enter the code sent to your registered number.'}
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75">
          Verification Code
        </span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={verificationForm.otp}
          onChange={(event) =>
            setVerificationForm((current) => ({ ...current, otp: event.target.value }))
          }
          className={`${glassFieldClass} tracking-[0.3em]`}
          placeholder="000000"
        />
      </label>
      {fieldErrors.otp && <p className="text-sm text-rose-200">{fieldErrors.otp}</p>}
      <div className="flex items-center justify-between text-sm text-white/75">
        <span>Verification code sent to your phone.</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              clearFeedback();
              setVerificationForm((current) => ({ ...current, otp: '' }));
              setView('phone-capture');
            }}
            className="underline underline-offset-4"
          >
            Change phone
          </button>
          <button
            type="button"
            onClick={async () => {
              setIsSubmitting(true);
              try {
                const result = await resendPhoneOtp();
                setDeliveryHint(result.deliveryHint || null);
                setAlert({
                  type: 'info',
                  message: buildAlertMessage(result.message, result.deliveryHint),
                });
              } catch (error) {
                setAlert({ type: 'error', message: mapAuthError(error) });
              } finally {
                setIsSubmitting(false);
              }
            }}
            className="underline underline-offset-4"
          >
            Resend Code
          </button>
        </div>
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Verify Phone
      </button>
    </form>
  );

  // The modal shell provides the reusable overlay, heading, alerts, and scrolling container.
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto px-4 py-6 md:items-center md:py-10"
      >
        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_42%),radial-gradient(circle_at_bottom,_rgba(14,165,233,0.14),_transparent_32%),rgba(2,6,23,0.82)] backdrop-blur-xl"
          aria-label="Close authentication modal"
        />

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/15 bg-slate-950/55 shadow-[0_30px_120px_rgba(15,23,42,0.55)] backdrop-blur-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
        >
          
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.12),rgba(15,23,42,0.18))]" />

          <div className="relative max-h-[85vh] overflow-y-auto px-6 pb-8 pt-6 md:px-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/70">
                  Client Access
                </p>
                <h2
                  id="auth-modal-title"
                  className="mt-3 text-3xl text-white"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {view === 'forgot-password'
                    ? 'Forgot your password?'
                    : view === 'reset-password'
                      ? 'Reset your password'
                      : view === 'verify-email'
                        ? 'Verify your email'
                        : view === 'phone-capture'
                          ? 'Add your phone number'
                          : view === 'phone-otp'
                            ? 'Verify your phone'
                            : authMode === 'signin'
                              ? 'Sign in to your dashboard'
                              : 'Create your client profile'}
                </h2>
                <p className="mt-2 max-w-xl text-sm text-white/70">
                  Secure client access for {BRAND_NAME} with protected sessions, verification,
                  and protected portal flows.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/15 bg-slate-950/50 p-2 text-white/75 transition hover:bg-slate-900/70 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {alert && (
              <div
                className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
                  alert.type === 'error'
                    ? 'border-rose-200/20 bg-rose-400/12 text-rose-50'
                    : alert.type === 'success'
                      ? 'border-emerald-200/20 bg-emerald-400/12 text-emerald-50'
                      : 'border-sky-200/20 bg-sky-400/12 text-sky-50'
                }`}
                aria-live="polite"
              >
                <div className="flex items-start gap-2">
                  {alert.type === 'success' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>{alert.message}</span>
                </div>
              </div>
            )}

            {view === 'credentials' && renderCredentialsView()}
            {view === 'forgot-password' && renderForgotPasswordView()}
            {view === 'reset-password' && renderResetPasswordView()}
            {view === 'verify-email' && renderVerifyEmailView()}
            {view === 'phone-capture' && renderPhoneCaptureView()}
            {view === 'phone-otp' && renderPhoneOtpView()}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
