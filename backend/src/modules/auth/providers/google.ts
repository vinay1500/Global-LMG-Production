import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env.js';
import { forbidden, serviceUnavailable, unauthorized } from '../../../lib/httpErrors.js';
import type { GoogleIdentity } from './types.js';

type GoogleTokenPayload = TokenPayload & {
  nonce?: string;
};

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const stringsMatchSafely = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyGoogleTokenPayload = (
  payload: GoogleTokenPayload | undefined,
  expectedNonce: string | undefined
) => {
  if (!expectedNonce?.trim()) {
    throw unauthorized('google_nonce_required', 'Google sign-in expired. Please try again.');
  }

  if (!payload?.sub || !payload.email) {
    throw unauthorized('google_identity_invalid', 'Google response did not include the required identity fields.');
  }

  if (env.GOOGLE_CLIENT_ID && payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw unauthorized('google_audience_invalid', 'Google sign-in token audience does not match this application.');
  }

  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw unauthorized('google_issuer_invalid', 'Google sign-in token issuer is not trusted.');
  }

  if (!payload.exp || payload.exp * 1000 <= Date.now()) {
    throw unauthorized('google_token_expired', 'Google sign-in expired. Please try again.');
  }

  if (!payload.email_verified) {
    throw unauthorized('google_email_unverified', 'Verify your Google account email before signing in.');
  }

  if (!payload.nonce?.trim()) {
    throw unauthorized('google_nonce_missing', 'Google sign-in expired. Please try again.');
  }

  if (!stringsMatchSafely(payload.nonce.trim(), expectedNonce.trim())) {
    throw unauthorized('google_nonce_mismatch', 'Google sign-in expired. Please try again.');
  }

  return {
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    fullName: payload.name?.trim() || payload.email,
    pictureUrl: payload.picture,
    subject: payload.sub,
  } satisfies GoogleIdentity;
};

const verifyWithGoogleJwt = async (credential: string, expectedNonce: string | undefined) => {
  let payload: TokenPayload | undefined;

  try {
    const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      audience: env.GOOGLE_CLIENT_ID,
      idToken: credential,
    });
    payload = ticket.getPayload();
  } catch {
    throw unauthorized('google_token_invalid', 'Google authentication could not be verified.');
  }

  return verifyGoogleTokenPayload(payload, expectedNonce);
};

export const googleAuthProvider = {
  async resolveIdentity(credential: string | undefined, options: { nonce?: string } = {}) {
    if (!options.nonce?.trim()) {
      throw unauthorized('google_nonce_required', 'Google sign-in expired. Please try again.');
    }

    if (env.GOOGLE_AUTH_MODE === 'preview') {
      return {
        email: env.PREVIEW_GOOGLE_EMAIL.trim().toLowerCase(),
        emailVerified: true,
        fullName: env.PREVIEW_GOOGLE_NAME,
        subject: env.PREVIEW_GOOGLE_EMAIL.trim().toLowerCase(),
      } satisfies GoogleIdentity;
    }

    if (env.GOOGLE_AUTH_MODE === 'disabled') {
      throw forbidden(
        'google_sign_in_disabled',
        'Google sign-in is not available right now.'
      );
    }

    if (!credential?.trim()) {
      throw unauthorized('google_credential_required', 'Google sign-in requires an ID token.');
    }

    if (!env.GOOGLE_CLIENT_ID) {
      throw serviceUnavailable(
        'google_provider_misconfigured',
        'Google sign-in is missing the client ID configuration.'
      );
    }

    return verifyWithGoogleJwt(credential.trim(), options.nonce);
  },
};
