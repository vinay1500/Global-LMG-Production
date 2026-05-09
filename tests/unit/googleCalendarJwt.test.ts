import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type GoogleCalendarClientModule =
  typeof import('../../admin_backend/src/modules/events/googleCalendarClient.js');

const originalEnv = { ...process.env };
const fixedNowSeconds = 1_779_000_000;

const setProcessEnv = (nextEnv: NodeJS.ProcessEnv) => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  Object.assign(process.env, nextEnv);
};

const restoreProcessEnv = () => {
  setProcessEnv(originalEnv);
};

const safeBaseEnv = (overrides: NodeJS.ProcessEnv = {}) => ({
  ...originalEnv,
  APP_ENV: 'development',
  AUTH_SESSION_SECRET: 'unit-test-admin-session-secret-with-more-than-thirty-two-chars',
  CALENDAR_ADMIN_AUTH_MODE: 'workspace_delegation',
  CALENDAR_SYNC_MODE: 'disabled',
  DOCUMENT_STORAGE_DRIVER: 'local',
  EMAIL_PROVIDER_MODE: 'disabled',
  FILE_SCAN_MODE: 'disabled',
  OBJECT_STORAGE_DRIVER: 'local',
  SMS_PROVIDER_MODE: 'disabled',
  ...overrides,
});

const loadGoogleCalendarClient = async (
  overrides: NodeJS.ProcessEnv = {},
  unsetEnv: string[] = [],
) => {
  vi.resetModules();

  const nextEnv = safeBaseEnv(overrides);
  for (const key of unsetEnv) {
    delete nextEnv[key];
  }
  setProcessEnv(nextEnv);

  return (await import(
    '../../admin_backend/src/modules/events/googleCalendarClient.js'
  )) as GoogleCalendarClientModule;
};

const decodeJwtJson = <TValue>(segment: string) =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as TValue;

afterEach(() => {
  restoreProcessEnv();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('Google Calendar service-account JWT helpers', () => {
  it('creates an RS256 JWT assertion with three base64url segments', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

    const jwt = googleCalendarClient.createJwtAssertion({
      audience: 'https://oauth2.googleapis.com/token',
      impersonatedEmail: 'admin@globallmg.org',
      nowSeconds: fixedNowSeconds,
      privateKey: privateKeyPem,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      serviceAccountEmail: 'calendar-service-account@example.iam.gserviceaccount.com',
    });

    const segments = jwt.split('.');

    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment).not.toMatch(/[+/=]/);
      expect(segment.length).toBeGreaterThan(0);
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    const header = decodeJwtJson<{ alg: string; typ: string }>(headerSegment);
    const payload = decodeJwtJson<{
      aud: string;
      exp: number;
      iat: number;
      iss: string;
      scope: string;
      sub: string;
    }>(payloadSegment);

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      aud: 'https://oauth2.googleapis.com/token',
      exp: fixedNowSeconds + 3600,
      iat: fixedNowSeconds,
      iss: 'calendar-service-account@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      sub: 'admin@globallmg.org',
    });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerSegment}.${payloadSegment}`);
    verifier.end();

    expect(verifier.verify(publicKeyPem, signatureSegment, 'base64url')).toBe(true);
  });

  it('returns false when required Google Calendar env vars are missing', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient(
      {
        CALENDAR_SYNC_MODE: 'google',
      },
      [
        'GOOGLE_CALENDAR_CLIENT_EMAIL',
        'GOOGLE_CALENDAR_PRIVATE_KEY',
        'GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY',
      ],
    );

    expect(googleCalendarClient.isGoogleCalendarConfigured()).toBe(false);
  });

  it('allows impersonated emails inside the configured Workspace domain', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient();

    expect(
      googleCalendarClient.isGoogleCalendarImpersonatedEmailAllowed(
        'admin@globallmg.org',
        'globallmg.org',
      ),
    ).toBe(true);
    expect(
      googleCalendarClient.isGoogleCalendarImpersonatedEmailAllowed(
        'Admin@GlobalLMG.Org',
        'GLOBALLMG.ORG',
      ),
    ).toBe(true);
  });

  it('rejects impersonated emails outside the configured Workspace domain', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient();

    expect(
      googleCalendarClient.isGoogleCalendarImpersonatedEmailAllowed(
        'admin@gmail.com',
        'globallmg.org',
      ),
    ).toBe(false);
    expect(
      googleCalendarClient.isGoogleCalendarImpersonatedEmailAllowed(
        'admin@otherdomain.com',
        'globallmg.org',
      ),
    ).toBe(false);
  });

  it('preserves current missing-domain policy by allowing organizer emails when no domain is configured', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient();

    expect(googleCalendarClient.isGoogleCalendarImpersonatedEmailAllowed('admin@gmail.com')).toBe(
      true,
    );
    expect(googleCalendarClient.isGoogleCalendarImpersonatedEmailAllowed('admin@gmail.com', '')).toBe(
      true,
    );
  });

  it('builds a client-safe Google Calendar description without internal notes or matter details', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient();
    const description = googleCalendarClient.buildClientSafeGoogleCalendarDescription();

    expect(description).toContain('Purpose: Global LMG coordination meeting.');
    expect(description).toContain('Global LMG portal');
    expect(description).not.toContain('Matter:');
    expect(description).not.toContain('Client:');
    expect(description).not.toContain('internal');

    const source = readFileSync(
      resolve(process.cwd(), 'admin_backend/src/modules/events/googleCalendarClient.ts'),
      'utf8',
    );
    expect(source).toContain('description: buildClientSafeGoogleCalendarDescription()');
    expect(source).not.toContain('event.notes ||');
    expect(source).not.toContain('Matter: ${event.matterTitle}');
    expect(source).not.toContain('Client: ${event.clientName}');
  });

  it('uses an explicit configured calendar ID when present', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient({
      GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID: 'calendar@example.com',
      GOOGLE_CALENDAR_ID: 'legacy-calendar@example.com',
    });

    expect(googleCalendarClient.getGoogleCalendarIdConfig()).toEqual({
      calendarId: 'calendar@example.com',
      defaultedToPrimary: false,
      source: 'GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID',
    });
  });

  it('defaults to primary only for Workspace delegation when no calendar ID is configured', async () => {
    const googleCalendarClient = await loadGoogleCalendarClient(
      {
        CALENDAR_ADMIN_AUTH_MODE: 'workspace_delegation',
      },
      ['GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID', 'GOOGLE_CALENDAR_ID'],
    );

    expect(googleCalendarClient.getGoogleCalendarIdConfig()).toEqual({
      calendarId: 'primary',
      defaultedToPrimary: true,
      source: 'workspace_delegation_primary',
    });
  });
});
