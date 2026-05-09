export type AuthProvider = 'email' | 'google';
export type ClientTypeCode = 'business' | 'individual' | 'organization';

export interface AuthAccountRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  oauthSubject?: string;
  country: string;
  clientType?: ClientTypeCode;
  passwordHash: string;
  provider: AuthProvider;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface LegalAcceptanceRecord {
  acceptanceTypeCode: string;
  acceptedAt: string;
  ipAddress?: string | null;
  sourceCode: string;
  userAgent?: string | null;
}

export interface ClientPrimaryAddressRecord {
  city: string;
  country: string;
  line1: string;
  line2?: string | null;
  postalCode: string;
  sourceCode?: 'google' | 'ip_prefill' | 'manual';
  state: string;
  googlePlaceId?: string | null;
  validationStatusCode?: 'manual' | 'unverified' | 'verified';
}

export interface AuthSessionRecord {
  accountId: string;
  createdAt: string;
  expiresAt: string;
  hashedToken: string;
  lastSeenAt: string;
  rememberMe: boolean;
}

export type AuthFlowPurpose = 'sign-in' | 'sign-up' | 'google' | 'password-reset';
export type ChallengeType = 'email' | 'phone' | 'password-reset';
export type PhoneChallengeProvider = 'preview' | 'twilio' | 'twilio-verify';

export interface PendingChallenge {
  type: ChallengeType;
  attemptCount?: number;
  expiresAt: string;
  hashedCode?: string;
  lastSentAt: string;
  phoneSnapshot?: string;
  providerCode?: PhoneChallengeProvider;
  providerReference?: string;
}

export interface AuthFlowRecord {
  accountId: string;
  createdAt: string;
  expiresAt: string;
  hashedToken: string;
  purpose: AuthFlowPurpose;
  rememberMe: boolean;
  emailChallenge?: PendingChallenge;
  phoneChallenge?: PendingChallenge;
  passwordResetChallenge?: PendingChallenge;
}

export interface AuthSessionUser {
  avatar: string;
  email: string;
  id: string;
  joinedAt: string;
  lastActiveAt: string;
  lifecycle: string;
  name: string;
  owner: string;
  phone: string;
  region: string;
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
  user?: AuthSessionUser;
}

export interface AuthStore {
  initialize: () => Promise<void>;
  deleteFlowByHashedToken: (hashedToken: string) => Promise<void>;
  deleteSessionByHashedToken: (hashedToken: string) => Promise<void>;
  deleteSessionsByAccountId: (accountId: string) => Promise<void>;
  getAccountByEmail: (email: string) => Promise<AuthAccountRecord | undefined>;
  getAccountById: (id: string) => Promise<AuthAccountRecord | undefined>;
  getAccountByOAuthSubject: (
    providerCode: AuthProvider,
    providerSubject: string
  ) => Promise<AuthAccountRecord | undefined>;
  getAccountByPhone: (phone: string) => Promise<AuthAccountRecord | undefined>;
  getFlowByHashedToken: (hashedToken: string) => Promise<AuthFlowRecord | undefined>;
  getSessionByHashedToken: (hashedToken: string) => Promise<AuthSessionRecord | undefined>;
  incrementFlowChallengeAttempt: (
    hashedToken: string,
    challengeType: ChallengeType
  ) => Promise<number>;
  saveAccount: (
    account: AuthAccountRecord,
    options?: { legalAcceptance?: LegalAcceptanceRecord; primaryAddress?: ClientPrimaryAddressRecord }
  ) => Promise<void>;
  saveFlow: (flow: AuthFlowRecord) => Promise<void>;
  saveSession: (session: AuthSessionRecord) => Promise<void>;
}
