import { createHash, createSign } from 'node:crypto';
import { env } from '../../config/env.js';
import { providerFetch } from '../../lib/providerHttp.js';

type GoogleCalendarEvent = {
  calendarOwnerEmail: string | null;
  cancelledAt: string | null;
  clientEmail: string | null;
  clientInviteModeCode: string;
  clientName: string;
  externalMeetingId: string | null;
  googleAttendeeStatusCode: string;
  joinUrl: string | null;
  locationText: string | null;
  matterTitle: string | null;
  meetConferenceId: string | null;
  modeCode: string;
  notes: string | null;
  publicId: string;
  scheduledEndAt: string;
  scheduledStartAt: string;
  statusCode: string;
  timezoneName: string;
  title: string;
};

export type GoogleCalendarSyncResult =
  | {
      conferenceId: string | null;
      errorText: null;
      externalEventId: string;
      joinUrl: string | null;
      providerCode: 'google-calendar';
      status: 'synced';
    }
  | {
      errorText: string;
      providerCode: 'google-calendar';
      status: 'failed';
    };

class GoogleCalendarError extends Error {
  statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'GoogleCalendarError';
    this.statusCode = statusCode;
  }
}

const cachedAccessTokens = new Map<string, { expiresAtMs: number; token: string }>();

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const truncate = (value: string, maxLength = 1000) =>
  value.length > maxLength ? value.slice(0, maxLength - 1) : value;

const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const normalizePrivateKey = (value: string) => value.replace(/\\n/g, '\n');

export const isGoogleCalendarConfigured = () =>
  Boolean(
    env.CALENDAR_SYNC_MODE === 'google' &&
      env.CALENDAR_ADMIN_AUTH_MODE === 'workspace_delegation' &&
      env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL &&
      env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY
  );

const buildDeterministicGoogleEventId = (eventPublicId: string) => {
  const digest = createHash('sha256').update(eventPublicId).digest('hex');
  return `glmg${digest}`;
};

const toGoogleDateTime = (mysqlDateTime: string) =>
  mysqlDateTime.includes('T') ? mysqlDateTime : mysqlDateTime.replace(' ', 'T');

const safeGoogleErrorMessage = async (response: Response) => {
  const body = await response.text();

  if (!body) {
    return `Google Calendar API request failed with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return truncate(parsed.error?.message || `Google Calendar API request failed with status ${response.status}.`);
  } catch {
    return truncate(`Google Calendar API request failed with status ${response.status}.`);
  }
};

type CreateJwtAssertionInput =
  | string
  | {
      audience?: string;
      impersonatedEmail: string;
      nowSeconds?: number;
      privateKey?: string;
      scope?: string;
      serviceAccountEmail?: string;
    };

export const createJwtAssertion = (input: CreateJwtAssertionInput) => {
  const impersonatedEmail = typeof input === 'string' ? input : input.impersonatedEmail;
  const privateKey =
    typeof input === 'string'
      ? env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY
      : input.privateKey ?? env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY;
  const serviceAccountEmail =
    typeof input === 'string'
      ? env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL
      : input.serviceAccountEmail ?? env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL;

  if (!privateKey || !serviceAccountEmail) {
    throw new GoogleCalendarError('Google Calendar service account credentials are not configured.');
  }

  const now =
    typeof input === 'string'
      ? Math.floor(Date.now() / 1000)
      : input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    aud: typeof input === 'string' ? GOOGLE_TOKEN_URL : input.audience ?? GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
    iss: serviceAccountEmail,
    scope: typeof input === 'string' ? GOOGLE_CALENDAR_SCOPE : input.scope ?? GOOGLE_CALENDAR_SCOPE,
    sub: impersonatedEmail,
  });
  const unsigned = `${header}.${payload}`;

  try {
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(normalizePrivateKey(privateKey), 'base64url');

    return `${unsigned}.${signature}`;
  } catch {
    throw new GoogleCalendarError('Google Calendar private key could not be parsed.');
  }
};

const getAccessToken = async (impersonatedEmail: string) => {
  const cachedAccessToken = cachedAccessTokens.get(impersonatedEmail);

  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const body = new URLSearchParams({
    assertion: createJwtAssertion(impersonatedEmail),
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
  });
  const response = await providerFetch(GOOGLE_TOKEN_URL, {
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    operation: 'google_calendar_token',
    providerCode: 'google-calendar',
    retryDelayMs: 250,
    safeToRetry: true,
  });

  if (!response.ok) {
    throw new GoogleCalendarError(await safeGoogleErrorMessage(response), response.status);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!payload.access_token) {
    throw new GoogleCalendarError('Google Calendar token response did not include an access token.');
  }

  cachedAccessTokens.set(impersonatedEmail, {
    expiresAtMs: Date.now() + Math.max(payload.expires_in || 3600, 60) * 1000,
    token: payload.access_token,
  });

  return payload.access_token;
};

const googleCalendarRequest = async <TResponse>(
  impersonatedEmail: string,
  path: string,
  init: RequestInit
): Promise<TResponse> => {
  const accessToken = await getAccessToken(impersonatedEmail);
  const response = await providerFetch(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    operation: `google_calendar_${(init.method || 'GET').toString().toLowerCase()}`,
    providerCode: 'google-calendar',
    retryDelayMs: 250,
    safeToRetry: true,
  });

  if (!response.ok) {
    throw new GoogleCalendarError(await safeGoogleErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return {} as TResponse;
  }

  return (await response.json()) as TResponse;
};

type GoogleEventResponse = {
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  hangoutLink?: string;
  id?: string;
};

export const isGoogleCalendarImpersonatedEmailAllowed = (
  email: string,
  allowedDomain = env.GOOGLE_CALENDAR_IMPERSONATE_DOMAIN,
) => {
  const normalizedDomain = allowedDomain?.trim().toLowerCase();
  if (!normalizedDomain) {
    return true;
  }

  return email.trim().toLowerCase().endsWith(`@${normalizedDomain}`);
};

const getCalendarOwnerEmail = (event: GoogleCalendarEvent) => {
  const email = event.calendarOwnerEmail?.trim().toLowerCase();

  if (!email) {
    throw new GoogleCalendarError('Calendar organizer email is missing.');
  }

  if (!isGoogleCalendarImpersonatedEmailAllowed(email)) {
    throw new GoogleCalendarError('Calendar organizer email is outside the allowed Google Workspace domain.');
  }

  return email;
};

export const getGoogleCalendarIdConfig = () => {
  const configuredCalendarId = env.GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID || env.GOOGLE_CALENDAR_ID;

  if (configuredCalendarId) {
    return {
      calendarId: configuredCalendarId,
      defaultedToPrimary: false,
      source: env.GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID
        ? 'GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID'
        : 'GOOGLE_CALENDAR_ID',
    };
  }

  if (env.CALENDAR_ADMIN_AUTH_MODE !== 'workspace_delegation') {
    throw new GoogleCalendarError(
      'Google Calendar calendar ID is required unless Workspace delegation can use the organizer primary calendar.'
    );
  }

  return {
    calendarId: 'primary',
    defaultedToPrimary: true,
    source: 'workspace_delegation_primary',
  };
};

const getCalendarId = () => getGoogleCalendarIdConfig().calendarId;

export const buildClientSafeGoogleCalendarDescription = () =>
  [
    'Purpose: Global LMG coordination meeting.',
    'This invite is for scheduling and joining the meeting. Please use the Global LMG portal for confidential case details, documents, and messages.',
    'Global LMG is not a law firm and does not provide direct legal advice.',
  ].join('\n\n');

const buildCalendarEventBody = (event: GoogleCalendarEvent, externalEventId: string) => {
  const requestMeetLink = event.modeCode === 'video' && !event.meetConferenceId;
  const attendees =
    env.CALENDAR_CLIENT_INVITE_MODE === 'google_attendee' &&
    event.clientInviteModeCode === 'google_attendee' &&
    event.clientEmail
      ? [{ email: event.clientEmail, displayName: event.clientName }]
      : undefined;

  return {
    attendees,
    description: buildClientSafeGoogleCalendarDescription(),
    ...(requestMeetLink
      ? {
          conferenceData: {
            createRequest: {
              conferenceSolutionKey: { type: 'hangoutsMeet' },
              requestId: buildDeterministicGoogleEventId(event.publicId),
            },
          },
        }
      : {}),
    id: externalEventId,
    location: event.modeCode === 'video' ? undefined : event.locationText || undefined,
    start: { dateTime: toGoogleDateTime(event.scheduledStartAt), timeZone: event.timezoneName },
    end: { dateTime: toGoogleDateTime(event.scheduledEndAt), timeZone: event.timezoneName },
    summary: event.title,
  };
};

const getMeetJoinUrl = (response: GoogleEventResponse) =>
  response.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === 'video')?.uri ||
  response.hangoutLink ||
  null;

const calendarPath = (eventId?: string) => {
  const encodedCalendarId = encodeURIComponent(getCalendarId());
  const base = `/calendars/${encodedCalendarId}/events`;

  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
};

const syncEventUpsert = async (event: GoogleCalendarEvent): Promise<GoogleCalendarSyncResult> => {
  const calendarOwnerEmail = getCalendarOwnerEmail(event);
  const externalEventId = event.externalMeetingId || buildDeterministicGoogleEventId(event.publicId);
  const query = `conferenceDataVersion=1&sendUpdates=${encodeURIComponent(env.GOOGLE_CALENDAR_SEND_UPDATES)}`;
  const body = buildCalendarEventBody(event, externalEventId);
  let response: GoogleEventResponse;

  if (event.externalMeetingId) {
    try {
      response = await googleCalendarRequest<GoogleEventResponse>(calendarOwnerEmail, `${calendarPath(externalEventId)}?${query}`, {
        body: JSON.stringify(body),
        method: 'PATCH',
      });
    } catch (error) {
      if (!(error instanceof GoogleCalendarError) || error.statusCode !== 404) {
        throw error;
      }

      response = await googleCalendarRequest<GoogleEventResponse>(calendarOwnerEmail, `${calendarPath()}?${query}`, {
        body: JSON.stringify(body),
        method: 'POST',
      });
    }
  } else {
    try {
      response = await googleCalendarRequest<GoogleEventResponse>(calendarOwnerEmail, `${calendarPath()}?${query}`, {
        body: JSON.stringify(body),
        method: 'POST',
      });
    } catch (error) {
      if (!(error instanceof GoogleCalendarError) || error.statusCode !== 409) {
        throw error;
      }

      response = await googleCalendarRequest<GoogleEventResponse>(calendarOwnerEmail, `${calendarPath(externalEventId)}?${query}`, {
        body: JSON.stringify(body),
        method: 'PATCH',
      });
    }
  }

  return {
    conferenceId: event.modeCode === 'video' ? response.conferenceData?.conferenceId || event.meetConferenceId || null : null,
    errorText: null,
    externalEventId: response.id || externalEventId,
    joinUrl: event.modeCode === 'video' ? getMeetJoinUrl(response) || event.joinUrl : null,
    providerCode: 'google-calendar',
    status: 'synced',
  };
};

const syncEventCancel = async (event: GoogleCalendarEvent): Promise<GoogleCalendarSyncResult> => {
  const calendarOwnerEmail = getCalendarOwnerEmail(event);
  const externalEventId = event.externalMeetingId || buildDeterministicGoogleEventId(event.publicId);

  try {
    await googleCalendarRequest<Record<string, never>>(
      calendarOwnerEmail,
      `${calendarPath(externalEventId)}?sendUpdates=${encodeURIComponent(env.GOOGLE_CALENDAR_SEND_UPDATES)}`,
      { method: 'DELETE' }
    );
  } catch (error) {
    if (!(error instanceof GoogleCalendarError) || error.statusCode !== 404) {
      throw error;
    }
  }

  return {
    conferenceId: event.meetConferenceId,
    errorText: null,
    externalEventId,
    joinUrl: event.joinUrl,
    providerCode: 'google-calendar',
    status: 'synced',
  };
};

export const syncGoogleCalendarEvent = async (
  event: GoogleCalendarEvent
): Promise<GoogleCalendarSyncResult> => {
  try {
    if (event.statusCode === 'cancelled' || event.cancelledAt) {
      return await syncEventCancel(event);
    }

    return await syncEventUpsert(event);
  } catch (error) {
    return {
      errorText: error instanceof Error ? truncate(error.message) : 'Google Calendar sync failed.',
      providerCode: 'google-calendar',
      status: 'failed',
    };
  }
};
