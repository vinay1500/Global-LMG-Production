import 'dotenv/config';
import { z } from 'zod';

const rawEnv = { ...process.env };

if (!rawEnv.SMS_PROVIDER_MODE && rawEnv.PHONE_PROVIDER_MODE) {
  rawEnv.SMS_PROVIDER_MODE = rawEnv.PHONE_PROVIDER_MODE;
}

if (!rawEnv.MYSQL_SSL_CA && rawEnv.MYSQL_SSL_CA_PATH) {
  rawEnv.MYSQL_SSL_CA = rawEnv.MYSQL_SSL_CA_PATH;
}

if (!rawEnv.MYSQL_CONNECT_TIMEOUT_MS && rawEnv.MYSQL_CONNECTION_TIMEOUT_MS) {
  rawEnv.MYSQL_CONNECT_TIMEOUT_MS = rawEnv.MYSQL_CONNECTION_TIMEOUT_MS;
}

if (!rawEnv.API_JSON_BODY_LIMIT && rawEnv.JSON_BODY_LIMIT) {
  rawEnv.API_JSON_BODY_LIMIT = rawEnv.JSON_BODY_LIMIT;
}

if (!rawEnv.PUBLIC_WEB_ORIGIN && rawEnv.PUBLIC_WEB_ORIGINS) {
  rawEnv.PUBLIC_WEB_ORIGIN = rawEnv.PUBLIC_WEB_ORIGINS.split(',')[0]?.trim();
}

if (!rawEnv.PUBLIC_WEB_ORIGINS) {
  rawEnv.PUBLIC_WEB_ORIGINS = rawEnv.PUBLIC_WEB_ORIGIN || 'http://localhost:5173';
}

if (rawEnv.OBJECT_STORAGE_DRIVER) {
  rawEnv.DOCUMENT_STORAGE_DRIVER = rawEnv.OBJECT_STORAGE_DRIVER;
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

const commaSeparatedUrlList = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return value;
}, z.array(z.string().url()).min(1));

const smsProviderMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'twilio-sms' || normalized === 'twilio-messaging') {
    return 'twilio';
  }

  return normalized;
}, z.enum(['preview', 'disabled', 'twilio', 'twilio-verify']));

const googleAuthMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'google-tokeninfo') {
    return 'google-jwt';
  }

  return normalized;
}, z.enum(['preview', 'disabled', 'google-jwt']));

const fileScanMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.enum(['disabled', 'clamav']));

const addressValidationMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.enum(['disabled', 'google']));

const ipGeolocationMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.enum(['disabled', 'cloudflare', 'provider', 'maxmind', 'manual']));

const fxProviderMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'manual' ? 'api' : normalized;
}, z.enum(['api']));

const usdCurrency = z.preprocess(() => 'USD', z.literal('USD'));

const paymentProviderMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.enum(['disabled', 'razorpay']));

const razorpayCaptureMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}, z.enum(['auto', 'manual']));

const mysqlSslMode = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toUpperCase();
}, z.enum(['DISABLED', 'REQUIRED']));

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  REQUEST_LOGGING_ENABLED: booleanFromEnv.default(true),
  SENTRY_DSN: optionalString,
  SENTRY_ENVIRONMENT: optionalString,
  SENTRY_RELEASE: optionalString,
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  PORT: z.coerce.number().int().positive().default(3001),
  API_JSON_BODY_LIMIT: bodySizeLimit.default('1mb'),
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  PUBLIC_WEB_ORIGINS: commaSeparatedUrlList,
  AUTH_STORE_MODE: z.enum(['mysql']).default('mysql'),
  DASHBOARD_STORE_MODE: z.enum(['mysql']).default('mysql'),
  HEALTHCHECK_REQUIRE_MYSQL: booleanFromEnv.default(true),
  SESSION_COOKIE_NAME: z.string().min(1).default('global_lmg_session'),
  AUTH_FLOW_COOKIE_NAME: z.string().min(1).default('global_lmg_auth_flow'),
  CSRF_COOKIE_NAME: z.string().min(1).default('global_lmg_csrf'),
  AUTH_SESSION_SECRET: z.string().min(32).default('change-this-development-session-secret-now'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  REMEMBER_ME_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAX_ACTIVE_SESSIONS_PER_USER: z.coerce.number().int().positive().default(10),
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  PHONE_OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_FLOW_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_IP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
  EMAIL_PROVIDER_MODE: z.enum(['preview', 'disabled', 'resend']).default('disabled'),
  SMS_PROVIDER_MODE: smsProviderMode.default('disabled'),
  GOOGLE_AUTH_MODE: googleAuthMode.default('disabled'),
  EMAIL_FROM_ADDRESS: optionalString,
  RESEND_API_KEY: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_FROM_NUMBER: optionalString,
  TWILIO_MESSAGING_SERVICE_SID: optionalString,
  TWILIO_VERIFY_SERVICE_SID: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  ADDRESS_VALIDATION_MODE: addressValidationMode.default('disabled'),
  GOOGLE_MAPS_API_KEY: optionalString,
  GOOGLE_ADDRESS_VALIDATION_API_KEY: optionalString,
  IP_GEOLOCATION_MODE: ipGeolocationMode.default('disabled'),
  IP_GEOLOCATION_PROVIDER_API_KEY: optionalString,
  DEFAULT_PRICING_COUNTRY: z.string().trim().min(2).max(8).default('US'),
  DEFAULT_PRICING_CURRENCY: usdCurrency,
  FX_BASE_CURRENCY: usdCurrency,
  FX_DEFAULT_FALLBACK_POLICY: z.enum(['fail_closed', 'use_base_currency']).default('fail_closed'),
  FX_PROVIDER_MODE: fxProviderMode.default('api'),
  FX_PROVIDER_URL_TEMPLATE: optionalString,
  PAYMENT_PROVIDER_MODE: paymentProviderMode.default('disabled'),
  RAZORPAY_CAPTURE_MODE: razorpayCaptureMode.default('auto'),
  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  RAZORPAY_WEBHOOK_IP_ALLOWLIST: optionalString,
  RAZORPAY_ALLOWED_CURRENCIES: z.string().min(1).default('USD'),
  REQUEST_PAYMENT_DRAFT_EXPIRY_MINUTES: z.coerce.number().int().positive().default(30),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  NOTIFICATION_RETENTION_ONLY_DISMISSED: booleanFromEnv.default(true),
  PREVIEW_ACCOUNT_ENABLED: booleanFromEnv.default(false),
  PREVIEW_ACCOUNT_ID: z.string().min(1).default('user-1'),
  PREVIEW_ACCOUNT_NAME: z.string().min(1).default('Arjun Mehta'),
  PREVIEW_ACCOUNT_EMAIL: z.string().email().default('arjun.m@example.com'),
  PREVIEW_ACCOUNT_PHONE: z.string().min(8).default('+91 98765 43210'),
  PREVIEW_ACCOUNT_COUNTRY: z.string().min(2).default('IN'),
  PREVIEW_ACCOUNT_PASSWORD: z.string().min(8).default('Preview@123'),
  PREVIEW_GOOGLE_EMAIL: z.string().email().default('preview.google@globallmg.org'),
  PREVIEW_GOOGLE_NAME: z.string().min(2).default('Google Preview Client'),
  PREVIEW_GOOGLE_COUNTRY: z.string().min(2).default('IN'),
  MYSQL_HOST: optionalString,
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().max(200).default(10),
  MYSQL_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  MYSQL_QUEUE_LIMIT: z.coerce.number().int().nonnegative().max(10000).default(100),
  MYSQL_WAIT_FOR_CONNECTIONS: booleanFromEnv.default(true),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_DATABASE: optionalString,
  MYSQL_PASSWORD: optionalString,
  MYSQL_SSL_CA: optionalString,
  MYSQL_SSL_MODE: mysqlSslMode.default('DISABLED'),
  MYSQL_USER: optionalString,
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
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
});

const parsedEnv = envSchema.parse(rawEnv);

export const isPlaceholderLikeSessionSecret = (value: string) =>
  /(change[-_\s]?this|change[-_\s]?me|development|dev[-_\s]?secret|placeholder|replace[-_\s]?me|example|sample|test[-_\s]?secret|secret[-_\s]?key|password|changeme)/i.test(
    value
  ) ||
  new Set(value.trim()).size < 12 ||
  /^(.)\1+$/.test(value.trim());

if (parsedEnv.APP_ENV !== 'development') {
  parsedEnv.FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN = true;
  parsedEnv.FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN = true;
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

if (parsedEnv.SMS_PROVIDER_MODE === 'twilio-verify') {
  if (!parsedEnv.TWILIO_ACCOUNT_SID || !parsedEnv.TWILIO_AUTH_TOKEN || !parsedEnv.TWILIO_VERIFY_SERVICE_SID) {
    throw new Error(
      'SMS_PROVIDER_MODE=twilio-verify requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID.'
    );
  }
}

if (parsedEnv.SMS_PROVIDER_MODE === 'twilio') {
  if (!parsedEnv.TWILIO_ACCOUNT_SID || !parsedEnv.TWILIO_AUTH_TOKEN) {
    throw new Error('SMS_PROVIDER_MODE=twilio requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
  }

  if (!parsedEnv.TWILIO_FROM_NUMBER && !parsedEnv.TWILIO_MESSAGING_SERVICE_SID) {
    throw new Error('SMS_PROVIDER_MODE=twilio requires either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.');
  }
}

if (parsedEnv.GOOGLE_AUTH_MODE === 'google-jwt' && !parsedEnv.GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_AUTH_MODE=google-jwt requires GOOGLE_CLIENT_ID.');
}

if (parsedEnv.PAYMENT_PROVIDER_MODE === 'razorpay') {
  if (!parsedEnv.RAZORPAY_KEY_ID || !parsedEnv.RAZORPAY_KEY_SECRET) {
    throw new Error('PAYMENT_PROVIDER_MODE=razorpay requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
}

if (parsedEnv.APP_ENV !== 'development' && parsedEnv.PREVIEW_ACCOUNT_ENABLED) {
  throw new Error('PREVIEW_ACCOUNT_ENABLED is only allowed when APP_ENV=development.');
}

if (parsedEnv.APP_ENV === 'production') {
  if (isPlaceholderLikeSessionSecret(parsedEnv.AUTH_SESSION_SECRET)) {
    throw new Error('Production AUTH_SESSION_SECRET must be a strong non-placeholder secret.');
  }

  if (!parsedEnv.PUBLIC_WEB_ORIGIN.startsWith('https://')) {
    throw new Error('Production PUBLIC_WEB_ORIGIN must use https://');
  }

  if (parsedEnv.PUBLIC_WEB_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('Production PUBLIC_WEB_ORIGINS entries must use https://');
  }

  if (
    parsedEnv.EMAIL_PROVIDER_MODE === 'preview' ||
    parsedEnv.SMS_PROVIDER_MODE === 'preview' ||
    parsedEnv.GOOGLE_AUTH_MODE === 'preview'
  ) {
    throw new Error('Preview auth providers are not allowed when APP_ENV=production.');
  }
}

export const env = parsedEnv;
