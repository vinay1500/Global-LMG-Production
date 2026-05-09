# Production Environment Variables

Last updated: 2026-05-07

This guide lists the production environment contract for Global LMG. Use it with:

```bash
npm run validate:production-env -- \
  --backend-env /etc/global-lmg/backend.env \
  --admin-env /etc/global-lmg/admin_backend.env \
  --frontend-env /srv/global-lmg/current/frontend/.env.production \
  --admin-frontend-env /srv/global-lmg/current/admin_frontend/.env.production
```

The validator does not print secret values. Keep real env files outside Git.

## Validation Warning Policy

Run validation against the real server env files, not only the placeholder
examples:

```bash
npm run validate:production-env -- \
  --backend-env /etc/global-lmg/backend.env \
  --admin-env /etc/global-lmg/admin_backend.env \
  --frontend-env /srv/global-lmg/current/frontend/.env.production \
  --admin-frontend-env /srv/global-lmg/current/admin_frontend/.env.production \
  --strict-providers
```

Public launch target: `0 failures, 0 warnings`. Placeholder example files are
expected to fail until real secrets, DSNs, provider credentials, and storage
values are installed on the server.

Warning classification:

- Sentry DSN missing: must fix before public launch; acceptable for local or
  early staging only.
- Email/SMS/payments disabled: must fix before public launch when the matching
  workflow is user-facing; acceptable for local or staging-only dry runs.
- Local document storage: must fix before multi-host public launch; acceptable
  only for local development or disposable single-host staging.
- File scanning disabled: must fix before public launch for uploaded
  documents; acceptable only for local development where downloads remain
  non-production.
- Google client auth disabled: acceptable only when Google sign-in is not shown
  in the production UI. If the Google button is enabled, configure
  `GOOGLE_AUTH_MODE=google-jwt`, backend `GOOGLE_CLIENT_ID`, and frontend
  `VITE_GOOGLE_CLIENT_ID`.
- Google Calendar sync disabled: intentionally acceptable when launch uses
  local/manual calendar handling. If Google Calendar invites are part of the
  public launch promise, configure Workspace delegation and run with
  `--strict-providers`.
- Admin bootstrap enabled: acceptable only during first-admin creation; disable
  immediately afterward.

## Safe Examples

Placeholder-only production examples live in:

- `deploy/env/backend.env.production.example`
- `deploy/env/admin_backend.env.production.example`
- `deploy/env/frontend.env.production.example`
- `deploy/env/admin_frontend.env.production.example`

Copy these to your server-only env location and replace placeholders there. Do not copy real values back into the repository.

## Secret Generation

Generate separate secrets for `backend` and `admin_backend`:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Do not reuse the same `AUTH_SESSION_SECRET` between the client API and admin API.

## Backend Required Values

`backend` is the client/public API.

Required core values:

- `APP_ENV=production`
- `PORT=3001`
- `API_JSON_BODY_LIMIT=1mb`
- `PUBLIC_WEB_ORIGIN=https://app.globallmg.org` or the actual deployed client/public web origin
- `AUTH_SESSION_SECRET=<strong unique secret>`
- `SESSION_COOKIE_NAME=global_lmg_session`
- `CSRF_COOKIE_NAME=global_lmg_csrf`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_CONNECTION_LIMIT=20`
- `MYSQL_QUEUE_LIMIT=100`
- `MYSQL_WAIT_FOR_CONNECTIONS=true`
- `MYSQL_CONNECT_TIMEOUT_MS=5000`
- `MYSQL_SSL_MODE=REQUIRED`
- `MYSQL_SSL_CA_PATH=/etc/global-lmg/aiven-ca.pem` or `MYSQL_SSL_CA=<pem content>`

Provider values:

- `EMAIL_PROVIDER_MODE=disabled|resend`
- If `resend`: `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`
- `SMS_PROVIDER_MODE=disabled|twilio|twilio-verify`
- If `twilio-verify`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- If `twilio`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`

Observability:

- `SENTRY_DSN=<client-api-project-dsn>`
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_RELEASE=<git-sha-or-release-version>`
- `SENTRY_TRACES_SAMPLE_RATE=0.05`

Google client auth:

- Use `GOOGLE_AUTH_MODE=disabled` unless Google sign-in is fully configured.
- Use `GOOGLE_AUTH_MODE=google-jwt` only with `GOOGLE_CLIENT_ID` on the backend and matching `VITE_GOOGLE_CLIENT_ID` on the frontend.
- Do not use preview or tokeninfo-style modes in production.

Address, display estimate, and tax context:

- `VITE_ADDRESS_AUTOCOMPLETE_MODE=disabled|google`
- `VITE_GOOGLE_MAPS_API_KEY=<browser-restricted-google-maps-key>` when frontend address autocomplete is enabled.
- `ADDRESS_VALIDATION_MODE=disabled|google`
- `GOOGLE_MAPS_API_KEY` or `GOOGLE_ADDRESS_VALIDATION_API_KEY` when server-side Google Address Validation is enabled.
- `IP_GEOLOCATION_MODE=disabled|cloudflare|provider|maxmind|manual`
- `IP_GEOLOCATION_PROVIDER_API_KEY` is reserved for a configured geolocation provider.
- `DEFAULT_PRICING_COUNTRY=US`
- `DEFAULT_PRICING_CURRENCY=USD`
- `FX_PROVIDER_MODE=api`
- `FX_BASE_CURRENCY=USD`
- `FX_DEFAULT_FALLBACK_POLICY=fail_closed|use_base_currency`
- `FX_PROVIDER_URL_TEMPLATE=<optional custom URL template>`

Exchange rates are automatic and display-only. By default the APIs use the
fawazahmed0 exchange-api package endpoints through jsDelivr with the Cloudflare
Pages mirror as fallback; set `FX_PROVIDER_URL_TEMPLATE` only when routing
through an approved internal mirror. Missing FX data should hide the local
estimate and must not block USD request, invoice, or payment creation.

Online payments:

- `PAYMENT_PROVIDER_MODE=disabled|razorpay`
- If `razorpay`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_CAPTURE_MODE=auto|manual`
- `RAZORPAY_ALLOWED_CURRENCIES=USD`
- The frontend receives only the Razorpay key id and order id returned by the client API. Keep key secret and webhook secret in the backend env only.
- Razorpay webhooks should point to the client API route: `/api/v1/webhooks/razorpay`.
- Optional: `RAZORPAY_WEBHOOK_IP_ALLOWLIST=<comma-separated IPs/CIDRs>`. Leave blank unless you are maintaining current provider egress ranges. Razorpay webhook signature verification remains mandatory.
- Optional Nginx allowlist example: `deploy/nginx/client-api.conf` includes a
  commented exact-location block for `/api/v1/webhooks/razorpay`. Enable it
  only after verifying current Razorpay webhook source ranges from Razorpay
  docs/dashboard. Do not hardcode unverified or stale ranges.
- Razorpay International/foreign-currency payments must be enabled in the Razorpay dashboard. Clients are charged in USD; Razorpay settlement to an Indian bank account is an external reconciliation concern and must not change invoice currency.

Country context priority is explicit request country, saved primary billing
address, IP country fallback, phone country, then platform default. It is used
for optional local-currency display and tax/risk context only; official pricing
and payment remain USD. Store only country/source for IP geolocation; do not
store raw geolocation payloads.

Active pricing and billing are USD-only. Service prices, consultation fees,
urgency fees, quotes, invoices, invoice PDFs, invoice emails, payment
transactions, and Razorpay orders use the frozen USD amount. Country detection
is retained only for address/tax/risk context and optional display estimates,
for example `$120.00 (approx. ₹10,000)`. Exact country price overrides are
retired from active quote calculation; historical FX metadata remains in the
schema for already-created snapshots and future audit flexibility.

Storage/scanning:

- Production multi-host deployments should use `OBJECT_STORAGE_DRIVER=s3` and `DOCUMENT_STORAGE_DRIVER=s3`.
- Early single-host launches may temporarily use local storage only with
  `DOCUMENT_STORAGE_DRIVER=local` and an absolute private path such as
  `DOCUMENT_STORAGE_ROOT=/srv/global-lmg/shared/uploads`. This path must be
  outside Git and outside `/srv/global-lmg/current`, must not be served
  directly by Nginx, and must have tested backup/restore. See
  `docs/object-storage.md`.
- S3 mode requires `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Malware scanning should use `FILE_SCAN_MODE=clamav`, `CLAMAV_HOST`, and `CLAMAV_PORT`.
- Client JSON bodies default to `API_JSON_BODY_LIMIT=1mb`; this is intended
  for auth, dashboard, request metadata, and payment callbacks. Document bytes
  are uploaded as `application/octet-stream` through route-level raw parsers
  governed by `DOCUMENT_UPLOAD_MAX_BYTES`, so increasing file size limits does
  not require increasing JSON body limits. `JSON_BODY_LIMIT` is accepted as a
  compatibility alias when `API_JSON_BODY_LIMIT` is not set.

## Admin Backend Required Values

`admin_backend` is the admin API.

Required core values:

- `APP_ENV=production`
- `PORT=3005`
- `ADMIN_JSON_BODY_LIMIT=2mb`
- `PUBLIC_ADMIN_WEB_ORIGIN=https://admin.globallmg.org`
- `AUTH_SESSION_SECRET=<strong unique admin secret>`
- `SESSION_COOKIE_NAME=global_lmg_admin_session`
- `CSRF_COOKIE_NAME=global_lmg_admin_csrf`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_CONNECTION_LIMIT=20`
- `MYSQL_QUEUE_LIMIT=100`
- `MYSQL_WAIT_FOR_CONNECTIONS=true`
- `MYSQL_CONNECT_TIMEOUT_MS=5000`
- `MYSQL_SSL_MODE=REQUIRED`
- `MYSQL_SSL_CA_PATH=/etc/global-lmg/aiven-ca.pem` or `MYSQL_SSL_CA=<pem content>`

Provider values:

- `EMAIL_PROVIDER_MODE=disabled|resend`
- If `resend`: `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`
- `SMS_PROVIDER_MODE=disabled|twilio|twilio-verify`
- If `twilio`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`
- `WEBHOOK_PUBLIC_BASE_URL=https://admin-api.globallmg.org` when provider webhooks are enabled
- `RESEND_WEBHOOK_SECRET` when Resend webhooks are configured
- `TWILIO_WEBHOOK_AUTH_TOKEN` when Twilio status webhooks are configured
- Optional: `RESEND_WEBHOOK_IP_ALLOWLIST` and `TWILIO_WEBHOOK_IP_ALLOWLIST` as comma-separated IPs/CIDRs. Leave blank if provider ranges are not actively maintained; webhook signatures remain mandatory.
- Optional Nginx allowlist examples: `deploy/nginx/admin-api.conf` includes
  commented exact-location blocks for `/api/v1/webhooks/resend` and
  `/api/v1/webhooks/twilio/status`. Enable them only after verifying current
  provider webhook source ranges from Resend/Twilio docs or dashboards.
  Signature verification remains mandatory in the app.

Webhook allowlist testing:

- With the Nginx allowlist disabled, a valid signed provider webhook should
  reach the app and pass signature verification.
- Invalid signatures should fail in the app even when the source IP is allowed.
- With the Nginx allowlist enabled and verified CIDRs installed, non-provider
  IPs should receive an Nginx-level denial before the request reaches the app.
- Keep app-level webhook rate limiting and optional env allowlists enabled as
  defense in depth; do not rely on IP allowlisting alone.

Admin JSON bodies default to `ADMIN_JSON_BODY_LIMIT=2mb`, intentionally larger
than the client API because admin settings, invoice templates, and reporting
filters can carry more structured metadata. Admin document bytes still use
`application/octet-stream` upload routes governed by `DOCUMENT_UPLOAD_MAX_BYTES`;
webhooks also use route-specific raw/urlencoded parsers. `JSON_BODY_LIMIT` is
accepted as a compatibility alias when `ADMIN_JSON_BODY_LIMIT` is not set.

Observability:

- `SENTRY_DSN=<admin-api-project-dsn>`
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_RELEASE=<git-sha-or-release-version>`
- `SENTRY_TRACES_SAMPLE_RATE=0.05`

Calendar:

- `CALENDAR_SYNC_MODE=disabled|google`
- If `google`, set:
  - `CALENDAR_ADMIN_AUTH_MODE=workspace_delegation`
  - `CALENDAR_CLIENT_INVITE_MODE=google_attendee`
  - `GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL`
  - `GOOGLE_CALENDAR_SERVICE_ACCOUNT_PRIVATE_KEY`
  - `GOOGLE_CALENDAR_SEND_UPDATES=all`
  - `GOOGLE_CALENDAR_IMPERSONATE_DOMAIN=globallmg.org`

Bootstrap:

- `ADMIN_BOOTSTRAP_ENABLED=false` after the first production admin is created.
- Keep bootstrap passwords only in ignored server env files when temporarily needed.

## Frontend Required Values

Public/client frontend:

- `VITE_PUBLIC_SITE_URL=https://app.globallmg.org` or the actual public/client web origin
- `VITE_API_BASE_URL=/api` when Nginx proxies `/api` to the backend
- `VITE_GOOGLE_CLIENT_ID` only when backend `GOOGLE_AUTH_MODE=google-jwt`
- `VITE_SENTRY_DSN=<public-frontend-project-dsn>`
- `VITE_SENTRY_ENVIRONMENT=production`
- `VITE_SENTRY_RELEASE=<git-sha-or-release-version>`
- `VITE_SENTRY_TRACES_SAMPLE_RATE=0.05`

Document uploads in the client portal require a browser secure context because
the frontend computes a SHA-256 checksum with `crypto.subtle.digest` before
requesting an upload intent. Production must use HTTPS. Localhost development
continues to work in modern browsers because `localhost` is treated as a secure
context; plain HTTP deployments on non-localhost hosts will fail gracefully with
`Secure browser context is required for document uploads.`

Admin frontend:

- `VITE_API_BASE_URL=/api` when Nginx proxies `/api` to the admin backend
- `VITE_SENTRY_DSN=<admin-frontend-project-dsn>`
- `VITE_SENTRY_ENVIRONMENT=production`
- `VITE_SENTRY_RELEASE=<git-sha-or-release-version>`
- `VITE_SENTRY_TRACES_SAMPLE_RATE=0.05`

## Current Validator Behavior

The validator fails for:

- non-production `APP_ENV`
- weak or placeholder-like `AUTH_SESSION_SECRET`
- non-HTTPS web origins
- missing DB SSL
- malformed Sentry DSNs
- preview email/SMS modes
- invalid `GOOGLE_AUTH_MODE`
- missing required provider variables when a provider/payment mode is enabled

The validator warns, but does not fail by default, for:

- disabled email/SMS/Google Calendar/Razorpay providers
- local document storage
- disabled file scanning
- disabled Google client auth
- missing Sentry DSNs

Use `--strict-providers` for a stricter pre-launch gate.
