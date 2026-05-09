import 'dotenv/config';
import { z } from 'zod';

const rawEnv = { ...process.env };

if (!rawEnv.MYSQL_SSL_CA && rawEnv.MYSQL_SSL_CA_PATH) {
  rawEnv.MYSQL_SSL_CA = rawEnv.MYSQL_SSL_CA_PATH;
}

if (!rawEnv.MYSQL_CONNECT_TIMEOUT_MS && rawEnv.MYSQL_CONNECTION_TIMEOUT_MS) {
  rawEnv.MYSQL_CONNECT_TIMEOUT_MS = rawEnv.MYSQL_CONNECTION_TIMEOUT_MS;
}

if (!rawEnv.ADMIN_JSON_BODY_LIMIT && rawEnv.JSON_BODY_LIMIT) {
  rawEnv.ADMIN_JSON_BODY_LIMIT = rawEnv.JSON_BODY_LIMIT;
}

if (rawEnv.OBJECT_STORAGE_DRIVER) {
  rawEnv.DOCUMENT_STORAGE_DRIVER = rawEnv.OBJECT_STORAGE_DRIVER;
}

if (!rawEnv.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL && rawEnv.GOOGLE_CALENDAR_CLIENT_EMAIL) {
  rawEnv.GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL = rawEnv.GOOGLE_CALENDAR_CLIENT_EMAIL;
}

if (!rawEnv.GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY && rawEnv.GOOGLE_CALENDAR_PRIVATE_KEY) {
  rawEnv.GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY = rawEnv.GOOGLE_CALENDAR_PRIVATE_KEY;
}

const optionalString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).optional());

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const bodySizeLimit = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.string().regex(/^\d+(?:\.\d+)?(?:b|kb|mb)$/));

const mysqlSslMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toUpperCase();
}, z.enum(['DISABLED', 'REQUIRED']));

const smsProviderMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'twilio-sms' || normalized === 'twilio-messaging') {
    return 'twilio';
  }

  return normalized;
}, z.enum(['disabled', 'preview', 'twilio', 'twilio-verify']));

const fileScanMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.enum(['disabled', 'clamav']));

const fxProviderMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'manual' ? 'api' : normalized;
}, z.enum(['api']));

const usdCurrency = z.preprocess(() => 'USD', z.literal('USD'));

const adminBootstrapRole = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.enum(['ops_admin', 'case_manager', 'billing_admin', 'messaging_desk', 'management_viewer']).default('ops_admin'));

const envSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: optionalString,
  ADMIN_BOOTSTRAP_ENABLED: booleanFromEnv.default(false),
  ADMIN_BOOTSTRAP_FORCE_ROTATION: booleanFromEnv.default(true),
  ADMIN_BOOTSTRAP_NAME: optionalString,
  ADMIN_BOOTSTRAP_PASSWORD: optionalString,
  ADMIN_BOOTSTRAP_RESET_PASSWORD: booleanFromEnv.default(false),
  ADMIN_BOOTSTRAP_ROLE: adminBootstrapRole,
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_SEND_EVENT_EMAIL: booleanFromEnv.default(false),
  CALENDAR_ADMIN_AUTH_MODE: z.enum(['workspace_delegation']).default('workspace_delegation'),
  CALENDAR_CLIENT_INVITE_MODE: z.enum(['none', 'google_attendee']).default('google_attendee'),
  CALENDAR_SYNC_MODE: z.enum(['disabled', 'google']).default('disabled'),
  AUTH_SESSION_SECRET: z.string().min(32),
  AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_LOCK_MINUTES: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  CSRF_COOKIE_NAME: z.string().min(1).default('global_lmg_admin_csrf'),
  OBJECT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  DOCUMENT_STORAGE_DRIVER: z.enum(['local', 's3', 'disabled']).default('local'),
  DOCUMENT_STORAGE_ROOT: z.string().min(1).default('../storage/glmg-uploads'),
  DOCUMENT_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  S3_ACCESS_KEY_ID: optionalString,
  S3_BUCKET: optionalString,
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().min(1).default('auto'),
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_SESSION_TOKEN: optionalString,
  S3_VERIFY_UPLOAD_SHA256: booleanFromEnv.default(true),
  FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN: booleanFromEnv.default(false),
  FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN: booleanFromEnv.default(true),
  FILE_SCAN_MODE: fileScanMode.default('disabled'),
  FILE_SCAN_PENDING_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(5),
  CLAMAV_HOST: optionalString,
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  EMAIL_PROVIDER_MODE: z.enum(['disabled', 'preview', 'resend']).default('disabled'),
  EMAIL_FROM_ADDRESS: optionalString,
  FX_BASE_CURRENCY: usdCurrency,
  FX_DEFAULT_FALLBACK_POLICY: z.enum(['fail_closed', 'use_base_currency']).default('fail_closed'),
  FX_PROVIDER_MODE: fxProviderMode.default('api'),
  FX_PROVIDER_URL_TEMPLATE: optionalString,
  HEALTHCHECK_REQUIRE_MYSQL: booleanFromEnv.default(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SENTRY_DSN: optionalString,
  SENTRY_ENVIRONMENT: optionalString,
  SENTRY_RELEASE: optionalString,
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  GOOGLE_CALENDAR_CLIENT_EMAIL: optionalString,
  GOOGLE_CALENDAR_DEFAULT_CALENDAR_ID: optionalString,
  GOOGLE_CALENDAR_ID: optionalString,
  GOOGLE_CALENDAR_IMPERSONATE_DOMAIN: optionalString,
  GOOGLE_CALENDAR_PRIVATE_KEY: optionalString,
  GOOGLE_CALENDAR_SEND_UPDATES: z.enum(['none', 'all', 'externalOnly']).default('none'),
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY: optionalString,
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().max(200).default(10),
  MYSQL_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MYSQL_DATABASE: optionalString,
  MYSQL_HOST: optionalString,
  MYSQL_PASSWORD: optionalString,
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_QUEUE_LIMIT: z.coerce.number().int().nonnegative().max(10000).default(100),
  MYSQL_SSL_CA: optionalString,
  MYSQL_SSL_MODE: mysqlSslMode.default('DISABLED'),
  MYSQL_USER: optionalString,
  MYSQL_WAIT_FOR_CONNECTIONS: booleanFromEnv.default(true),
  PORT: z.coerce.number().int().positive().default(3005),
  ADMIN_JSON_BODY_LIMIT: bodySizeLimit.default('2mb'),
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  PUBLIC_ADMIN_WEB_ORIGIN: z.string().url().default('http://localhost:5174'),
  REQUEST_LOGGING_ENABLED: booleanFromEnv.default(true),
  REMEMBER_ME_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAX_ACTIVE_SESSIONS_PER_USER: z.coerce.number().int().positive().default(10),
  REMINDER_PROCESS_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(25),
  RESEND_API_KEY: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,
  RESEND_WEBHOOK_IP_ALLOWLIST: optionalString,
  SESSION_COOKIE_NAME: z.string().min(1).default('global_lmg_admin_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SMS_PROVIDER_MODE: smsProviderMode.default('disabled'),
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_FROM_NUMBER: optionalString,
  TWILIO_MESSAGING_SERVICE_SID: optionalString,
  TWILIO_WEBHOOK_AUTH_TOKEN: optionalString,
  TWILIO_WEBHOOK_IP_ALLOWLIST: optionalString,
  TWILIO_VERIFY_SERVICE_SID: optionalString,
  WEBHOOK_PUBLIC_BASE_URL: optionalString,
});

const parsedEnv = envSchema.parse(rawEnv);

const isPlaceholderLikeSessionSecret = (value: string) =>
  /(change[-_\s]?this|change[-_\s]?me|development|dev[-_\s]?secret|placeholder|replace[-_\s]?me|example|sample|test[-_\s]?secret|secret[-_\s]?key|password|changeme)/i.test(
    value
  ) ||
  new Set(value.trim()).size < 12 ||
  /^(.)\1+$/.test(value.trim());

if (parsedEnv.APP_ENV !== 'development') {
  parsedEnv.FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN = true;
  parsedEnv.FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN = true;
}

if (parsedEnv.APP_ENV === 'production') {
  if (!parsedEnv.PUBLIC_ADMIN_WEB_ORIGIN.startsWith('https://')) {
    throw new Error('Production PUBLIC_ADMIN_WEB_ORIGIN must use HTTPS.');
  }

  if (isPlaceholderLikeSessionSecret(parsedEnv.AUTH_SESSION_SECRET)) {
    throw new Error('Production AUTH_SESSION_SECRET must be a strong non-placeholder secret.');
  }
}

if (parsedEnv.EMAIL_PROVIDER_MODE === 'resend') {
  if (!parsedEnv.RESEND_API_KEY || !parsedEnv.EMAIL_FROM_ADDRESS) {
    throw new Error(
      'EMAIL_PROVIDER_MODE=resend requires both RESEND_API_KEY and EMAIL_FROM_ADDRESS.'
    );
  }
}

if (parsedEnv.FILE_SCAN_MODE === 'clamav' && !parsedEnv.CLAMAV_HOST) {
  throw new Error('FILE_SCAN_MODE=clamav requires CLAMAV_HOST.');
}

if (parsedEnv.DOCUMENT_STORAGE_DRIVER === 's3') {
  if (
    !parsedEnv.S3_ENDPOINT ||
    !parsedEnv.S3_BUCKET ||
    !parsedEnv.S3_ACCESS_KEY_ID ||
    !parsedEnv.S3_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      'DOCUMENT_STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.'
    );
  }
}

if (parsedEnv.SMS_PROVIDER_MODE === 'twilio' || parsedEnv.SMS_PROVIDER_MODE === 'twilio-verify') {
  if (!parsedEnv.TWILIO_ACCOUNT_SID || !parsedEnv.TWILIO_AUTH_TOKEN) {
    throw new Error(
      'SMS provider mode requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.'
    );
  }

  if (
    parsedEnv.SMS_PROVIDER_MODE === 'twilio' &&
    !parsedEnv.TWILIO_FROM_NUMBER &&
    !parsedEnv.TWILIO_MESSAGING_SERVICE_SID
  ) {
    throw new Error(
      'SMS_PROVIDER_MODE=twilio requires either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.'
    );
  }
}

export const env = parsedEnv;
