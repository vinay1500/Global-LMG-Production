#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const args = process.argv.slice(2);
const options = {
  adminEnv: 'admin_backend/.env',
  adminFrontendEnv: 'admin_frontend/.env.production',
  backendEnv: 'backend/.env',
  frontendEnv: 'frontend/.env.production',
  strictProviders: false,
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = args[index + 1];

  if (arg === '--help' || arg === '-h') {
    console.log(`Usage:
  npm run validate:production-env -- [options]

Options:
  --backend-env <path>          Client API env file. Default backend/.env
  --admin-env <path>            Admin API env file. Default admin_backend/.env
  --frontend-env <path>         Public frontend env file. Default frontend/.env.production
  --admin-frontend-env <path>   Admin frontend env file. Default admin_frontend/.env.production
  --strict-providers            Treat disabled email/SMS/Google/storage/scan providers as failures; recommended for public launch.

No secret values are printed.`);
    process.exit(0);
  }

  if (arg === '--strict-providers') {
    options.strictProviders = true;
    continue;
  }

  if (arg === '--backend-env' && next) {
    options.backendEnv = next;
    index += 1;
    continue;
  }

  if (arg === '--admin-env' && next) {
    options.adminEnv = next;
    index += 1;
    continue;
  }

  if (arg === '--frontend-env' && next) {
    options.frontendEnv = next;
    index += 1;
    continue;
  }

  if (arg === '--admin-frontend-env' && next) {
    options.adminFrontendEnv = next;
    index += 1;
    continue;
  }

  throw new Error(`Unknown option: ${arg}`);
}

const parseEnvFile = (filePath) => {
  const absolutePath = path.resolve(repoRoot, filePath);

  if (!existsSync(absolutePath)) {
    return { absolutePath, exists: false, values: {} };
  }

  const values = {};
  const content = readFileSync(absolutePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return { absolutePath, exists: true, values };
};

const files = {
  admin_backend: parseEnvFile(options.adminEnv),
  admin_frontend: parseEnvFile(options.adminFrontendEnv),
  backend: parseEnvFile(options.backendEnv),
  frontend: parseEnvFile(options.frontendEnv),
};

const results = [];

const record = (status, scope, check, message) => {
  results.push({ check, message, scope, status });
};

const pass = (scope, check, message) => record('PASS', scope, check, message);
const warn = (scope, check, message) => record('WARN', scope, check, message);
const fail = (scope, check, message) => record('FAIL', scope, check, message);

const get = (env, key) => env[key]?.trim() || '';
const has = (env, key) => Boolean(get(env, key));
const isHttps = (value) => /^https:\/\//i.test(value);
const isRelativeApi = (value) => value.startsWith('/');
const providerDisabled = (scope, check, message) =>
  options.strictProviders
    ? fail(scope, check, message)
    : warn(scope, check, `${message} Acceptable for local/staging only unless explicitly documented for launch.`);
const placeholderSecretPattern =
  /(^<[^>]+>$|change[-_\s]?this|change[-_\s]?me|development|dev[-_\s]?secret|placeholder|replace[-_\s]?me|example|sample|test[-_\s]?secret|secret[-_\s]?key|password|changeme|generate[-_\s]?(?:different[-_\s]?)?strong|base64url[-_\s]?secret)/i;

const isPlaceholderLikeSecret = (value) => {
  const trimmed = value.trim();

  if (placeholderSecretPattern.test(trimmed)) {
    return true;
  }

  if (new Set(trimmed).size < 12) {
    return true;
  }

  if (/^(.)\1+$/.test(trimmed)) {
    return true;
  }

  return false;
};

const isPlaceholderLikeValue = (value) => placeholderSecretPattern.test(value.trim());

const validateRequiredValue = (scope, key, value, description = key, options = {}) => {
  if (!value) {
    fail(scope, key, `${description} is required.`);
    return false;
  }

  const placeholderLike = options.secret === false
    ? isPlaceholderLikeValue(value)
    : isPlaceholderLikeSecret(value);

  if (placeholderLike) {
    fail(scope, key, `${description} still looks placeholder-like.`);
    return false;
  }

  return true;
};

const validateProductionHostname = (scope, key, value, expectedHostname) => {
  if (!value || isRelativeApi(value)) {
    return;
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      fail(scope, key, `${key} must not point to localhost in production.`);
      return;
    }

    if (hostname.includes('beta.globallmg.org')) {
      fail(scope, key, `${key} must not point to beta.globallmg.org for production.`);
      return;
    }

    if (expectedHostname && hostname !== expectedHostname) {
      fail(scope, key, `${key} should point to ${expectedHostname} for the canonical production deployment.`);
    }
  } catch {
    // The caller handles malformed URL failures.
  }
};

const validateHttpsOrigin = (scope, key, value) => {
  if (!isHttps(value)) {
    fail(scope, key, `${key} must be an https:// origin in production.`);
    return;
  }

  try {
    const parsed = new URL(value);
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      fail(scope, key, `${key} must not point to localhost in production.`);
      return;
    }
  } catch {
    fail(scope, key, `${key} must be a valid HTTPS origin.`);
    return;
  }

  validateProductionHostname(scope, key, value);

  pass(scope, key, `${key} is a production HTTPS origin.`);
};

const parseCsvList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const validateHttpsOriginList = (scope, key, value, fallbackValue) => {
  const origins = parseCsvList(value || fallbackValue);

  if (origins.length === 0) {
    fail(scope, key, `${key} must list at least one HTTPS origin.`);
    return;
  }

  let hasFailure = false;
  for (const origin of origins) {
    if (!isHttps(origin)) {
      fail(scope, key, `${key} includes a non-HTTPS origin: ${origin}`);
      hasFailure = true;
      continue;
    }

    try {
      const parsed = new URL(origin);
      if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
        fail(scope, key, `${key} must not include localhost in production.`);
        hasFailure = true;
      }
    } catch {
      fail(scope, key, `${key} includes an invalid origin: ${origin}`);
      hasFailure = true;
    }

    validateProductionHostname(scope, key, origin);
  }

  if (!hasFailure) {
    pass(scope, key, `${key} contains production HTTPS origins.`);
  }
};

const validateRequiredFile = (scope, file) => {
  if (!file.exists) {
    fail(scope, 'env_file', `Missing env file: ${path.relative(repoRoot, file.absolutePath)}`);
    return false;
  }

  pass(scope, 'env_file', `Loaded ${path.relative(repoRoot, file.absolutePath)}`);
  return true;
};

const validateCoreApi = (scope, env, originKey, originListKey) => {
  if (get(env, 'APP_ENV') !== 'production') {
    fail(scope, 'APP_ENV', 'APP_ENV must be production.');
  } else {
    pass(scope, 'APP_ENV', 'APP_ENV is production.');
  }

  if (!has(env, 'AUTH_SESSION_SECRET') || get(env, 'AUTH_SESSION_SECRET').length < 32) {
    fail(scope, 'AUTH_SESSION_SECRET', 'AUTH_SESSION_SECRET must be a strong 32+ character secret.');
  } else if (isPlaceholderLikeSecret(get(env, 'AUTH_SESSION_SECRET'))) {
    fail(scope, 'AUTH_SESSION_SECRET', 'AUTH_SESSION_SECRET still looks placeholder-like or low entropy.');
  } else {
    pass(scope, 'AUTH_SESSION_SECRET', 'AUTH_SESSION_SECRET is present and not a known placeholder.');
  }

  validateHttpsOrigin(scope, originKey, get(env, originKey));
  validateHttpsOriginList(scope, originListKey, get(env, originListKey), get(env, originKey));

  pass(scope, 'COOKIE_SECURE', 'Session and CSRF cookies resolve to Secure in production runtime.');

  for (const key of ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER']) {
    if (!validateRequiredValue(scope, key, get(env, key), key, { secret: false })) {
      continue;
    }
  }

  validateRequiredValue(scope, 'MYSQL_PASSWORD', get(env, 'MYSQL_PASSWORD'));

  const mysqlConnectionLimit = Number(get(env, 'MYSQL_CONNECTION_LIMIT') || '0');
  const mysqlQueueLimit = Number(get(env, 'MYSQL_QUEUE_LIMIT') || '0');

  if (!Number.isInteger(mysqlConnectionLimit) || mysqlConnectionLimit <= 0) {
    fail(scope, 'MYSQL_CONNECTION_LIMIT', 'MYSQL_CONNECTION_LIMIT must be a positive integer.');
  } else {
    pass(scope, 'MYSQL_CONNECTION_LIMIT', 'MYSQL_CONNECTION_LIMIT is configured.');
  }

  if (!Number.isInteger(mysqlQueueLimit) || mysqlQueueLimit <= 0) {
    fail(scope, 'MYSQL_QUEUE_LIMIT', 'MYSQL_QUEUE_LIMIT must be a finite positive integer.');
  } else {
    pass(scope, 'MYSQL_QUEUE_LIMIT', 'MYSQL_QUEUE_LIMIT is finite.');
  }

  if (get(env, 'MYSQL_SSL_MODE').toUpperCase() !== 'REQUIRED') {
    fail(scope, 'MYSQL_SSL_MODE', 'MYSQL_SSL_MODE must be REQUIRED for production DB connections.');
  } else if (!has(env, 'MYSQL_SSL_CA') && !has(env, 'MYSQL_SSL_CA_PATH')) {
    fail(scope, 'MYSQL_SSL_CA', 'MYSQL_SSL_MODE=REQUIRED needs MYSQL_SSL_CA or MYSQL_SSL_CA_PATH.');
  } else {
    pass(scope, 'MYSQL_SSL', 'DB SSL is required and a CA variable is present.');
  }

  for (const key of ['SESSION_COOKIE_NAME', 'CSRF_COOKIE_NAME']) {
    if (!has(env, key)) {
      fail(scope, key, `${key} is required.`);
    }
  }
};

const validateEmail = (scope, env) => {
  const mode = get(env, 'EMAIL_PROVIDER_MODE') || 'disabled';

  if (mode === 'preview') {
    fail(scope, 'EMAIL_PROVIDER_MODE', 'preview email mode is not allowed in production.');
    return;
  }

  if (mode === 'disabled') {
    providerDisabled(scope, 'EMAIL_PROVIDER_MODE', 'Email provider is disabled; email workflows will be manual/local.');
    return;
  }

  if (mode !== 'resend') {
    fail(scope, 'EMAIL_PROVIDER_MODE', 'EMAIL_PROVIDER_MODE must be disabled or resend.');
    return;
  }

  if (!has(env, 'RESEND_API_KEY') || !has(env, 'EMAIL_FROM_ADDRESS')) {
    fail(scope, 'RESEND', 'EMAIL_PROVIDER_MODE=resend requires RESEND_API_KEY and EMAIL_FROM_ADDRESS.');
    return;
  }

  if (
    !validateRequiredValue(scope, 'RESEND_API_KEY', get(env, 'RESEND_API_KEY')) ||
    !validateRequiredValue(scope, 'EMAIL_FROM_ADDRESS', get(env, 'EMAIL_FROM_ADDRESS'), 'EMAIL_FROM_ADDRESS', { secret: false })
  ) {
    return;
  }

  if (scope === 'admin_backend') {
    if (
      !validateRequiredValue(scope, 'RESEND_WEBHOOK_SECRET', get(env, 'RESEND_WEBHOOK_SECRET')) ||
      !validateRequiredValue(scope, 'WEBHOOK_PUBLIC_BASE_URL', get(env, 'WEBHOOK_PUBLIC_BASE_URL'))
    ) {
      return;
    }
  }

  pass(scope, 'RESEND', 'Resend email mode has required variables.');
};

const validateSentry = (scope, env, dsnKey = 'SENTRY_DSN') => {
  const dsn = get(env, dsnKey);
  const sampleRate = Number(get(env, dsnKey === 'SENTRY_DSN' ? 'SENTRY_TRACES_SAMPLE_RATE' : 'VITE_SENTRY_TRACES_SAMPLE_RATE') || '0.05');

  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    fail(scope, 'SENTRY_TRACES_SAMPLE_RATE', 'Sentry trace sample rate must be between 0 and 1.');
    return;
  }

  if (!dsn) {
    warn(scope, dsnKey, 'Sentry DSN is not configured; runtime error monitoring is disabled. Must fix before public launch; acceptable for local/staging only.');
    return;
  }

  if (!/^https:\/\/[^@]+@[^/]+\/\d+/i.test(dsn)) {
    fail(scope, dsnKey, 'Sentry DSN must look like an HTTPS Sentry project DSN.');
    return;
  }

  pass(scope, dsnKey, 'Sentry DSN is configured.');
};

const validateSms = (scope, env) => {
  const mode = get(env, 'SMS_PROVIDER_MODE') || 'disabled';

  if (mode === 'preview') {
    fail(scope, 'SMS_PROVIDER_MODE', 'preview SMS mode is not allowed in production.');
    return;
  }

  if (mode === 'disabled') {
    providerDisabled(scope, 'SMS_PROVIDER_MODE', 'SMS provider is disabled; SMS workflows will be manual/local.');
    return;
  }

  if (!['twilio', 'twilio-verify'].includes(mode)) {
    fail(scope, 'SMS_PROVIDER_MODE', 'SMS_PROVIDER_MODE must be disabled, twilio, or twilio-verify.');
    return;
  }

  if (!has(env, 'TWILIO_ACCOUNT_SID') || !has(env, 'TWILIO_AUTH_TOKEN')) {
    fail(scope, 'TWILIO', 'Twilio mode requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    return;
  }

  if (
    !validateRequiredValue(scope, 'TWILIO_ACCOUNT_SID', get(env, 'TWILIO_ACCOUNT_SID')) ||
    !validateRequiredValue(scope, 'TWILIO_AUTH_TOKEN', get(env, 'TWILIO_AUTH_TOKEN'))
  ) {
    return;
  }

  if (mode === 'twilio' && !has(env, 'TWILIO_FROM_NUMBER') && !has(env, 'TWILIO_MESSAGING_SERVICE_SID')) {
    fail(scope, 'TWILIO', 'SMS_PROVIDER_MODE=twilio requires TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.');
    return;
  }

  if (
    mode === 'twilio' &&
    has(env, 'TWILIO_FROM_NUMBER') &&
    !validateRequiredValue(scope, 'TWILIO_FROM_NUMBER', get(env, 'TWILIO_FROM_NUMBER'), 'TWILIO_FROM_NUMBER', { secret: false })
  ) {
    return;
  }

  if (
    mode === 'twilio' &&
    has(env, 'TWILIO_MESSAGING_SERVICE_SID') &&
    !validateRequiredValue(scope, 'TWILIO_MESSAGING_SERVICE_SID', get(env, 'TWILIO_MESSAGING_SERVICE_SID'))
  ) {
    return;
  }

  if (mode === 'twilio-verify' && !has(env, 'TWILIO_VERIFY_SERVICE_SID')) {
    fail(scope, 'TWILIO_VERIFY_SERVICE_SID', 'SMS_PROVIDER_MODE=twilio-verify requires TWILIO_VERIFY_SERVICE_SID.');
    return;
  }

  if (
    mode === 'twilio-verify' &&
      !validateRequiredValue(scope, 'TWILIO_VERIFY_SERVICE_SID', get(env, 'TWILIO_VERIFY_SERVICE_SID'), 'TWILIO_VERIFY_SERVICE_SID', { secret: false })
  ) {
    return;
  }

  if (scope === 'admin_backend') {
    if (
      !validateRequiredValue(scope, 'TWILIO_WEBHOOK_AUTH_TOKEN', get(env, 'TWILIO_WEBHOOK_AUTH_TOKEN')) ||
      !validateRequiredValue(scope, 'WEBHOOK_PUBLIC_BASE_URL', get(env, 'WEBHOOK_PUBLIC_BASE_URL'))
    ) {
      return;
    }
  }

  pass(scope, 'TWILIO', `Twilio ${mode} mode has required variables.`);
};

const validatePayments = (scope, env) => {
  const mode = get(env, 'PAYMENT_PROVIDER_MODE') || 'disabled';

  if (mode === 'disabled') {
    providerDisabled(scope, 'PAYMENT_PROVIDER_MODE', 'Online payments are disabled; client payment will be manual/offline.');
    return;
  }

  if (mode === 'preview') {
    fail(scope, 'PAYMENT_PROVIDER_MODE', 'preview payment mode is not allowed in production.');
    return;
  }

  if (mode !== 'razorpay') {
    fail(scope, 'PAYMENT_PROVIDER_MODE', 'PAYMENT_PROVIDER_MODE must be disabled or razorpay.');
    return;
  }

  for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
    if (!has(env, key)) {
      fail(scope, key, `${key} is required for Razorpay payments.`);
    }
  }

  for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
    if (has(env, key)) {
      validateRequiredValue(scope, key, get(env, key));
    }
  }

  if (!['auto', 'manual'].includes(get(env, 'RAZORPAY_CAPTURE_MODE') || 'auto')) {
    fail(scope, 'RAZORPAY_CAPTURE_MODE', 'RAZORPAY_CAPTURE_MODE must be auto or manual.');
  }

  const allowedCurrencies = (get(env, 'RAZORPAY_ALLOWED_CURRENCIES') || 'USD')
    .split(',')
    .map((currency) => currency.trim().toUpperCase())
    .filter(Boolean);
  if (!allowedCurrencies.includes('USD')) {
    fail(
      scope,
      'RAZORPAY_ALLOWED_CURRENCIES',
      'RAZORPAY_ALLOWED_CURRENCIES must include USD because client invoices and payment orders are USD.'
    );
  }

  if (!results.some((result) => result.scope === scope && result.status === 'FAIL' && result.check.startsWith('RAZORPAY'))) {
    pass(scope, 'RAZORPAY', 'Razorpay payment mode has required variables.');
  }
};

const validateStorage = (scope, env) => {
  const driver = get(env, 'OBJECT_STORAGE_DRIVER') || get(env, 'DOCUMENT_STORAGE_DRIVER') || 'local';

  if (driver === 'local') {
    providerDisabled(scope, 'OBJECT_STORAGE_DRIVER', 'Local document storage is configured; use s3 for multi-host production.');
    return;
  }

  if (driver !== 's3') {
    fail(scope, 'OBJECT_STORAGE_DRIVER', 'OBJECT_STORAGE_DRIVER must be local or s3.');
    return;
  }

  for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    if (!has(env, key)) {
      fail(scope, key, `${key} is required for S3-compatible storage.`);
    }
  }

  validateRequiredValue(scope, 'S3_ENDPOINT', get(env, 'S3_ENDPOINT'), 'S3_ENDPOINT', { secret: false });
  validateRequiredValue(scope, 'S3_BUCKET', get(env, 'S3_BUCKET'), 'S3_BUCKET', { secret: false });
  validateRequiredValue(scope, 'S3_ACCESS_KEY_ID', get(env, 'S3_ACCESS_KEY_ID'), 'S3_ACCESS_KEY_ID', { secret: false });
  validateRequiredValue(scope, 'S3_SECRET_ACCESS_KEY', get(env, 'S3_SECRET_ACCESS_KEY'));

  if (results.some((result) => result.scope === scope && result.status === 'FAIL' && result.check.startsWith('S3_'))) {
    return;
  }

  pass(scope, 'S3_STORAGE', 'S3-compatible object storage has required variables.');
};

const validateScan = (scope, env) => {
  const mode = get(env, 'FILE_SCAN_MODE') || 'disabled';

  if (mode === 'disabled') {
    providerDisabled(scope, 'FILE_SCAN_MODE', 'File scanning is disabled; uploads will not be marked clean.');
    return;
  }

  if (mode !== 'clamav') {
    fail(scope, 'FILE_SCAN_MODE', 'FILE_SCAN_MODE must be disabled or clamav.');
    return;
  }

  if (!has(env, 'CLAMAV_HOST') || !has(env, 'CLAMAV_PORT')) {
    fail(scope, 'CLAMAV', 'FILE_SCAN_MODE=clamav requires CLAMAV_HOST and CLAMAV_PORT.');
  } else {
    pass(scope, 'CLAMAV', 'ClamAV mode has host/port configured.');
  }
};

const validateClientGoogleAuth = (scope, backendEnv, frontendEnv) => {
  const mode = get(backendEnv, 'GOOGLE_AUTH_MODE') || 'disabled';

  if (mode === 'preview') {
    fail(scope, 'GOOGLE_AUTH_MODE', 'preview Google auth mode is not allowed in production.');
    return;
  }

  if (mode === 'disabled') {
    providerDisabled(
      scope,
      'GOOGLE_AUTH_MODE',
      'Google client auth is disabled. This is safe only when Google sign-in is not offered in production UI.'
    );
    return;
  }

  if (mode !== 'google-jwt') {
    fail(scope, 'GOOGLE_AUTH_MODE', 'GOOGLE_AUTH_MODE must be disabled or google-jwt.');
    return;
  }

  if (!has(backendEnv, 'GOOGLE_CLIENT_ID') || !has(frontendEnv, 'VITE_GOOGLE_CLIENT_ID')) {
    fail(scope, 'GOOGLE_CLIENT_ID', 'Google auth needs GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID.');
  } else if (
    !validateRequiredValue(scope, 'GOOGLE_CLIENT_ID', get(backendEnv, 'GOOGLE_CLIENT_ID')) ||
    !validateRequiredValue(scope, 'VITE_GOOGLE_CLIENT_ID', get(frontendEnv, 'VITE_GOOGLE_CLIENT_ID'))
  ) {
    return;
  } else {
    pass(scope, 'GOOGLE_AUTH', 'Google client auth variables are present.');
  }
};

const validateCalendar = (scope, env) => {
  const mode = get(env, 'CALENDAR_SYNC_MODE') || 'disabled';

  if (mode === 'disabled') {
    providerDisabled(scope, 'CALENDAR_SYNC_MODE', 'Google Calendar sync is disabled; events remain local/manual.');
    return;
  }

  if (mode !== 'google') {
    fail(scope, 'CALENDAR_SYNC_MODE', 'CALENDAR_SYNC_MODE must be disabled or google.');
    return;
  }

  const required = [
    'GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_CALENDAR_SEND_UPDATES',
  ];
  for (const key of required) {
    if (!has(env, key)) {
      fail(scope, key, `${key} is required for Google Workspace calendar sync.`);
    }
  }

  if (get(env, 'CALENDAR_ADMIN_AUTH_MODE') !== 'workspace_delegation') {
    fail(scope, 'CALENDAR_ADMIN_AUTH_MODE', 'Calendar sync must use workspace_delegation.');
  }

  if (get(env, 'CALENDAR_CLIENT_INVITE_MODE') !== 'google_attendee') {
    warn(scope, 'CALENDAR_CLIENT_INVITE_MODE', 'Client attendee invites are not set to google_attendee.');
  }

  if (!results.some((result) => result.scope === scope && result.status === 'FAIL' && result.check.includes('GOOGLE_CALENDAR'))) {
    pass(scope, 'GOOGLE_CALENDAR', 'Google Workspace calendar sync variables are present.');
  }
};

const validateFrontend = (scope, env, apiKey) => {
  const apiBase = get(env, 'VITE_API_BASE_URL');
  const expectedApiHost = scope === 'frontend' ? 'api.globallmg.org' : 'admin-api.globallmg.org';

  if (!apiBase) {
    fail(scope, 'VITE_API_BASE_URL', 'VITE_API_BASE_URL is required.');
  } else if (!isRelativeApi(apiBase) && !isHttps(apiBase)) {
    fail(scope, 'VITE_API_BASE_URL', 'VITE_API_BASE_URL must be relative or https://.');
  } else {
    validateProductionHostname(scope, 'VITE_API_BASE_URL', apiBase, expectedApiHost);
    pass(scope, 'VITE_API_BASE_URL', `${apiKey} API base is production-safe.`);
  }

  if (scope === 'frontend' && has(env, 'VITE_PUBLIC_SITE_URL') && !isHttps(get(env, 'VITE_PUBLIC_SITE_URL'))) {
    fail(scope, 'VITE_PUBLIC_SITE_URL', 'VITE_PUBLIC_SITE_URL must use https://.');
  } else if (scope === 'frontend' && has(env, 'VITE_PUBLIC_SITE_URL')) {
    validateProductionHostname(scope, 'VITE_PUBLIC_SITE_URL', get(env, 'VITE_PUBLIC_SITE_URL'), 'app.globallmg.org');
  }
};

for (const [scope, file] of Object.entries(files)) {
  validateRequiredFile(scope, file);
}

if (files.backend.exists) {
  validateCoreApi('backend', files.backend.values, 'PUBLIC_WEB_ORIGIN', 'PUBLIC_WEB_ORIGINS');
  validateSentry('backend', files.backend.values);
  validateEmail('backend', files.backend.values);
  validateSms('backend', files.backend.values);
  validatePayments('backend', files.backend.values);
  validateStorage('backend', files.backend.values);
  validateScan('backend', files.backend.values);
}

if (files.admin_backend.exists) {
  validateCoreApi('admin_backend', files.admin_backend.values, 'PUBLIC_ADMIN_WEB_ORIGIN', 'PUBLIC_ADMIN_WEB_ORIGINS');
  validateSentry('admin_backend', files.admin_backend.values);
  validateEmail('admin_backend', files.admin_backend.values);
  validateSms('admin_backend', files.admin_backend.values);
  validateStorage('admin_backend', files.admin_backend.values);
  validateScan('admin_backend', files.admin_backend.values);
  validateCalendar('admin_backend', files.admin_backend.values);

  if (get(files.admin_backend.values, 'ADMIN_BOOTSTRAP_ENABLED') === 'true') {
    warn('admin_backend', 'ADMIN_BOOTSTRAP_ENABLED', 'Disable admin bootstrap after the first production admin is created.');
  }
}

if (files.frontend.exists) {
  validateFrontend('frontend', files.frontend.values, 'client');
  validateSentry('frontend', files.frontend.values, 'VITE_SENTRY_DSN');
}

if (files.admin_frontend.exists) {
  validateFrontend('admin_frontend', files.admin_frontend.values, 'admin');
  validateSentry('admin_frontend', files.admin_frontend.values, 'VITE_SENTRY_DSN');
}

if (files.backend.exists && files.frontend.exists) {
  validateClientGoogleAuth('backend/frontend', files.backend.values, files.frontend.values);
}

const order = { FAIL: 0, WARN: 1, PASS: 2 };
for (const result of results.sort((left, right) => order[left.status] - order[right.status] || left.scope.localeCompare(right.scope))) {
  console.log(`${result.status} [${result.scope}] ${result.check}: ${result.message}`);
}

const failCount = results.filter((result) => result.status === 'FAIL').length;
const warnCount = results.filter((result) => result.status === 'WARN').length;
const passCount = results.filter((result) => result.status === 'PASS').length;

console.log(`\nProduction env validation summary: ${passCount} passed, ${warnCount} warnings, ${failCount} failures.`);

if (failCount > 0) {
  process.exitCode = 1;
}
