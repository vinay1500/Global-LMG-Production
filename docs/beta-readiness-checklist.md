# Global LMG Beta Readiness Checklist

This checklist verifies the local/Aiven beta environment for Global LMG, an intermediary legal consultancy and lawyer-matching platform. It is designed for disposable development records and should not be run against production data unless each mutation step is explicitly approved.

## 1. Prerequisites

- Node.js and npm are installed.
- Dependencies are installed in all four apps:
  - `backend`
  - `frontend`
  - `admin_backend`
  - `admin_frontend`
- Aiven MySQL is reachable from this machine.
- Aiven CA certificate exists at `certs/aiven/ca.pem`.
- Local env files exist and are not committed:
  - `backend/.env`
  - `admin_backend/.env`
  - `frontend/.env` if local overrides are needed
  - `admin_frontend/.env` if local overrides are needed
- Local document storage exists and is writable:
  - `storage/glmg-uploads`
- Uploaded files remain ignored by git.
- The database has been migrated:
  - `cd backend && npm run migrate`
- The first admin account has been bootstrapped or already exists:
  - `cd admin_backend && npm run bootstrap:admin`

## 2. Required Environment Variables

### Backend

Required for local/Aiven beta:

- `APP_ENV=development`
- `PORT=3001`
- `PUBLIC_WEB_ORIGIN=http://127.0.0.1:5173`
- `AUTH_STORE_MODE=mysql`
- `DASHBOARD_STORE_MODE=mysql`
- `HEALTHCHECK_REQUIRE_MYSQL=true`
- `SESSION_COOKIE_NAME`
- `AUTH_FLOW_COOKIE_NAME`
- `CSRF_COOKIE_NAME`
- `AUTH_SESSION_SECRET`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_SSL_MODE=REQUIRED`
- `MYSQL_SSL_CA_PATH=../certs/aiven/ca.pem` for local beta, or an absolute
  path such as `/etc/global-lmg/certs/aiven-ca.pem` for production-like PM2
  runs.
- `DOCUMENT_STORAGE_DRIVER=local`
- `DOCUMENT_STORAGE_ROOT=../storage/glmg-uploads`
- `EMAIL_PROVIDER_MODE=disabled` unless a real provider is configured
- `SMS_PROVIDER_MODE=disabled` unless a real provider is configured
- `GOOGLE_AUTH_MODE=disabled` unless a real provider is configured

Useful for smoke tests:

- `PREVIEW_ACCOUNT_EMAIL`
- `PREVIEW_ACCOUNT_PASSWORD`

### Admin Backend

Required for local/Aiven beta:

- `APP_ENV=development`
- `PORT=3005`
- `PUBLIC_ADMIN_WEB_ORIGIN=http://127.0.0.1:5174`
- `HEALTHCHECK_REQUIRE_MYSQL=true`
- `SESSION_COOKIE_NAME`
- `CSRF_COOKIE_NAME`
- `AUTH_SESSION_SECRET`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_SSL_MODE=REQUIRED`
- `MYSQL_SSL_CA_PATH=../certs/aiven/ca.pem` for local beta, or an absolute
  path such as `/etc/global-lmg/certs/aiven-ca.pem` for production-like PM2
  runs.
- `DOCUMENT_STORAGE_DRIVER=local`
- `DOCUMENT_STORAGE_ROOT=../storage/glmg-uploads`
- `EMAIL_PROVIDER_MODE=disabled` unless a real provider is configured
- `SMS_PROVIDER_MODE=disabled` unless a real provider is configured
- `CALENDAR_SYNC_MODE=disabled` unless Google Calendar is explicitly configured

Admin bootstrap variables:

- `ADMIN_BOOTSTRAP_ENABLED`
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `ADMIN_BOOTSTRAP_NAME`
- `ADMIN_BOOTSTRAP_ROLE=ops_admin`
- `ADMIN_BOOTSTRAP_FORCE_ROTATION=true`
- `ADMIN_BOOTSTRAP_RESET_PASSWORD=false`

Use `ops_admin` for the first admin. Seeded operational roles also include
`case_manager`, `billing_admin`, `billing_staff`, `case_staff`, and `advocate`,
but restricted roles should be assigned through the admin provisioning flow
after the first admin exists.

Reminder processing:

- `REMINDER_PROCESS_BATCH_SIZE=25`

### Frontend

- `VITE_API_BASE_URL=http://127.0.0.1:3001/api/v1`

### Admin Frontend

- `VITE_ADMIN_API_BASE_URL=http://127.0.0.1:3005/api/v1/admin`

### Beta Smoke Script

Optional overrides:

- `BETA_SMOKE_CLIENT_WEB_BASE=http://127.0.0.1:5173`
- `BETA_SMOKE_ADMIN_WEB_BASE=http://127.0.0.1:5174`
- `BETA_SMOKE_CLIENT_API_BASE=http://127.0.0.1:3001/api/v1`
- `BETA_SMOKE_ADMIN_API_BASE=http://127.0.0.1:3005/api/v1/admin`
- `BETA_SMOKE_ADMIN_EMAIL`
- `BETA_SMOKE_ADMIN_PASSWORD`
- `BETA_SMOKE_CLIENT_EMAIL`
- `BETA_SMOKE_CLIENT_PASSWORD`
- `BETA_SMOKE_MUTATE=false`

The smoke script never prints passwords. By default it is read-only and does not create records.

Use explicit `BETA_SMOKE_*` credentials for authenticated smoke. Do not rely on
`ADMIN_BOOTSTRAP_PASSWORD` after first login because the admin is expected to
rotate that temporary password. Do not rely on preview account credentials unless
the preview account is explicitly enabled and known to exist in the current DB.

Recommended local pattern:

```bash
cat > /tmp/glmg-beta-smoke.env <<'EOF'
BETA_SMOKE_ADMIN_EMAIL=<active-admin-email>
BETA_SMOKE_ADMIN_PASSWORD=<current-rotated-admin-password>
BETA_SMOKE_CLIENT_EMAIL=<disposable-client-email>
BETA_SMOKE_CLIENT_PASSWORD=<disposable-client-password>
BETA_SMOKE_CLIENT_WEB_BASE=http://127.0.0.1:5173
BETA_SMOKE_ADMIN_WEB_BASE=http://127.0.0.1:5174
BETA_SMOKE_CLIENT_API_BASE=http://127.0.0.1:3001/api/v1
BETA_SMOKE_ADMIN_API_BASE=http://127.0.0.1:3005/api/v1/admin
EOF
chmod 600 /tmp/glmg-beta-smoke.env
BETA_SMOKE_ENV_FILES=/tmp/glmg-beta-smoke.env npm run smoke:beta
```

After a disposable DB reset, create or reset the smoke client before running
the smoke test:

```bash
BETA_SMOKE_ENV_FILES=/tmp/glmg-beta-smoke.env npm run setup:beta-smoke-client
```

The setup script reads `BETA_SMOKE_CLIENT_EMAIL` and
`BETA_SMOKE_CLIENT_PASSWORD`, hashes the password with the app's `scrypt`
format, and creates or repairs the client user, credential, active client role,
client account, portal contact, primary billing address, and notification
preferences. It never prints the password.

The script is for local/disposable beta data only. If the target env file still
has `APP_ENV=production` but the database is a freshly reset disposable beta DB,
you must opt in explicitly:

```bash
BETA_SMOKE_ENV_FILES=/tmp/glmg-beta-smoke.env \
BETA_SMOKE_SETUP_ALLOW_DISPOSABLE_DB=true \
npm run setup:beta-smoke-client
```

For safety, the configured smoke client email must look disposable: use a
`.local` address, a `+smoke` alias, or an address containing `smoke`.

Required smoke identity state:

- Admin user exists, `login_enabled=1`, has an active role, and does not require password rotation.
- Client user exists, `login_enabled=1`, email/phone verification is complete, and the linked client account is active.
- Passwords are stored only in ignored local env files or `/tmp` smoke env files, never in git.

### Live Playwright E2E

The Playwright suite can reuse the same disposable smoke identities. Keep the
credentials in `/tmp` or another ignored local file and export only variable
names in docs or CI logs.

Required variables:

- `E2E_RUN_LIVE=true`
- `E2E_RUN_MUTATIONS=false` for read-only auth checks
- `E2E_RUN_MUTATIONS=true` for disposable create/update workflows
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_CLIENT_EMAIL`
- `E2E_CLIENT_PASSWORD`
- `E2E_ADMIN_WEB_BASE`
- `E2E_CLIENT_WEB_BASE`
- `E2E_ADMIN_API_BASE`
- `E2E_CLIENT_API_BASE`

Safe local read-only pass:

```bash
set -a
source /tmp/glmg-beta-smoke.env
set +a
E2E_RUN_LIVE=true \
E2E_RUN_MUTATIONS=false \
E2E_ADMIN_EMAIL="$BETA_SMOKE_ADMIN_EMAIL" \
E2E_ADMIN_PASSWORD="$BETA_SMOKE_ADMIN_PASSWORD" \
E2E_CLIENT_EMAIL="$BETA_SMOKE_CLIENT_EMAIL" \
E2E_CLIENT_PASSWORD="$BETA_SMOKE_CLIENT_PASSWORD" \
E2E_ADMIN_WEB_BASE="$BETA_SMOKE_ADMIN_WEB_BASE" \
E2E_CLIENT_WEB_BASE="$BETA_SMOKE_CLIENT_WEB_BASE" \
E2E_ADMIN_API_BASE="$BETA_SMOKE_ADMIN_API_BASE" \
E2E_CLIENT_API_BASE="$BETA_SMOKE_CLIENT_API_BASE" \
npm run test:e2e
```

Safe disposable mutation pass:

```bash
set -a
source /tmp/glmg-beta-smoke.env
set +a
E2E_RUN_LIVE=true \
E2E_RUN_MUTATIONS=true \
E2E_ADMIN_EMAIL="$BETA_SMOKE_ADMIN_EMAIL" \
E2E_ADMIN_PASSWORD="$BETA_SMOKE_ADMIN_PASSWORD" \
E2E_CLIENT_EMAIL="$BETA_SMOKE_CLIENT_EMAIL" \
E2E_CLIENT_PASSWORD="$BETA_SMOKE_CLIENT_PASSWORD" \
E2E_ADMIN_WEB_BASE="$BETA_SMOKE_ADMIN_WEB_BASE" \
E2E_CLIENT_WEB_BASE="$BETA_SMOKE_CLIENT_WEB_BASE" \
E2E_ADMIN_API_BASE="$BETA_SMOKE_ADMIN_API_BASE" \
E2E_CLIENT_API_BASE="$BETA_SMOKE_CLIENT_API_BASE" \
npm run test:e2e
```

Mutation mode creates disposable records only. The extended package
selection/message fixture test skips unless the disposable client already has a
published or recommended package and a message thread fixture.

## 3. Start All Four Apps

Run each command in its own terminal:

```bash
cd backend
npm run dev
```

```bash
cd admin_backend
npm run dev
```

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

```bash
cd admin_frontend
npm run dev -- --host 127.0.0.1
```

Expected local URLs:

- Client frontend: `http://127.0.0.1:5173`
- Client API ready health: `http://127.0.0.1:3001/api/v1/health/ready`
- Admin frontend: `http://127.0.0.1:5174/login`
- Admin API ready health: `http://127.0.0.1:3005/api/v1/admin/health/ready`

## 4. Bootstrap Admin

1. Put the bootstrap values only in `admin_backend/.env`.
2. Run:

```bash
cd admin_backend
npm run bootstrap:admin
```

3. Log in at `http://127.0.0.1:5174/login`.
4. If `ADMIN_BOOTSTRAP_FORCE_ROTATION=true`, the admin must change the temporary password before accessing protected pages.

Rules:

- Do not commit `.env`.
- Do not print the password in tickets, logs, screenshots, or docs.
- Existing admin passwords are not reset unless `ADMIN_BOOTSTRAP_RESET_PASSWORD=true`.
- Production bootstrap must be explicit.

## 5. Disposable Client

Use a disposable client for beta QA:

- Prefer the configured preview client if `PREVIEW_ACCOUNT_EMAIL` and `PREVIEW_ACCOUNT_PASSWORD` exist.
- Otherwise create a self-service client through the client sign-up flow.
- Use a clear disposable label in name or email when mutation testing is enabled.
- Do not reuse real client records for destructive or lifecycle tests.

## 6. Build Verification

Run:

```bash
cd backend
npm run build
```

```bash
cd admin_backend
npm run build
```

```bash
cd frontend
npm run build
```

```bash
cd admin_frontend
npm run build
```

All four builds must pass before beta.

## 7. API Smoke Checklist

After all apps are running, execute the read-only smoke pass:

```bash
npm run smoke:beta
```

Equivalent direct command:

```bash
node scripts/beta-smoke.mjs
```

The smoke pass verifies:

- Client frontend HTML shell renders.
- Admin frontend login shell renders.
- Backend ready health reports MySQL ready.
- Admin backend ready health reports MySQL ready.
- Protected client/admin routes reject unauthenticated access.
- Reports export rejects unauthenticated access.
- Admin login/session works when credentials are supplied.
- Admin dashboard, reports, reminders, requests, billing, documents, messages, and events workspaces load.
- Admin CSRF protection rejects mutation without a CSRF token.
- Client login/dashboard works when credentials are supplied.
- Client CSRF protection rejects mutation without a CSRF token.

Read-only mode is the default. `BETA_SMOKE_MUTATE=true` is reserved for a future fixture-backed smoke mode and currently keeps mutation journeys in the manual checklist.

## 8. Manual Browser Checklist

### Auth and Security

- [ ] Admin login works at `http://127.0.0.1:5174/login`.
- [ ] Forced password rotation blocks protected pages until complete.
- [ ] Admin sign-out clears the session.
- [ ] Invalid admin login shows an error without leaking details.
- [ ] Admin rate limiting triggers after repeated invalid attempts.
- [ ] Unauthenticated admin routes return `401` or redirect to login.
- [ ] CSRF is required for admin mutations.
- [ ] Client sign-up or preview login works.
- [ ] Client sign-out clears the session.
- [ ] Unauthenticated client dashboard/API access is blocked.
- [ ] Disabled portal users cannot access protected client portal data if testable.

### Request to Matter

- [ ] Client submits a new request/intake.
- [ ] Admin sees the request in Requests.
- [ ] Admin approve/convert creates exactly one matter.
- [ ] Repeated convert does not create another matter.
- [ ] Admin decline/request-info updates request state.
- [ ] Client dashboard reflects request decision.
- [ ] Client receives relevant notification.
- [ ] Audit events record admin decisions.

### Matter Lifecycle and Packages

- [ ] Client sees converted matter.
- [ ] Admin updates matter status/stage.
- [ ] Client matter list/detail reflects updated status/stage.
- [ ] Admin-only notes do not appear client-side.
- [ ] Admin creates and publishes a package proposal.
- [ ] Client sees only published packages.
- [ ] Client selects exactly one package for the matter.
- [ ] Duplicate package selection is prevented.
- [ ] Admin override preserves selection history.
- [ ] Package selection can generate invoice when expected.

### Billing

- [ ] Admin creates draft invoice for a disposable matter.
- [ ] Admin issues/sends invoice.
- [ ] Client billing shows issued invoice.
- [ ] Admin records a partial manual payment below the balance.
- [ ] Invoice shows reduced balance and payment ledger entry.
- [ ] Client billing shows partial payment and balance.
- [ ] Admin records remaining payment.
- [ ] Invoice becomes paid on both admin and client views.
- [ ] Overpayment on a paid invoice is rejected.
- [ ] Payment and invoice events are audited and notified.

### Documents

- [ ] Client uploads a document to a permitted matter/request context.
- [ ] Admin sees the uploaded document.
- [ ] Admin uploads an internal document.
- [ ] Client cannot see internal/admin-only document.
- [ ] Admin changes document to client-visible.
- [ ] Client sees the client-visible document.
- [ ] Preview works only for safe supported file types.
- [ ] Download requires authentication and authorization.
- [ ] Version history is DB-backed.
- [ ] Cross-client document access is rejected.

### Messaging

- [ ] Client sends a general or matter-based message.
- [ ] Admin sees unread/waiting thread.
- [ ] Admin opens thread and unread count clears.
- [ ] Admin replies.
- [ ] Client sees unread reply.
- [ ] Client opens thread and unread count clears.
- [ ] Attachments are scoped to the same client/thread/matter.
- [ ] Closed or archived thread behavior is enforced.
- [ ] Internal admin notes do not leak as client messages.

### Events, Calendar, and Reminders

- [ ] Admin creates a client-visible event.
- [ ] Client sees the event.
- [ ] Admin updates event time/title/location/link.
- [ ] Client sees the update.
- [ ] Admin cancels the event.
- [ ] Client sees cancelled or removed state according to current UX.
- [ ] Google Calendar/Meet status is honest: synced, failed, or local/manual.
- [ ] No fake Meet link appears when Google is disabled.
- [ ] Reminder rows are created, updated, and cancelled with event lifecycle.
- [ ] Reminder queue shows real pending/failed counts.
- [ ] Failed reminder retry works and is audited.

### Reports and Exports

- [ ] Dashboard KPIs come from DB-backed API responses.
- [ ] Open requests KPI matches drilldown count.
- [ ] Active/stale/closed matter KPIs match drilldowns.
- [ ] Overdue/outstanding/paid invoice KPIs match drilldowns.
- [ ] Waiting/unread message thread KPI matches drilldown.
- [ ] Pending document review KPI matches drilldown.
- [ ] Upcoming event KPI matches drilldown.
- [ ] Pending/failed reminder KPIs match drilldowns.
- [ ] CSV export requires auth.
- [ ] CSV exports omit secrets, password hashes, raw tokens, and private file contents.

## 9. Fake or Deferred Control Review

Search production-routed UI before every release:

```bash
rg -n "Later|coming soon|mock|seed|fake|TODO|disabled buttons that look active|Export later" frontend/src admin_frontend/src backend/src admin_backend/src
```

Beta-acceptable findings:

- Explicitly disabled future controls that are visually disabled and do not imply success.
- Development-only seed/bootstrap helpers outside routed production paths.
- Comments describing planned work where no UI appears live.

Beta blockers:

- Buttons that look active but do nothing.
- Mock data shown in routed production pages.
- "Success" messages without a backend mutation.
- Exports that appear complete but return fake data.
- Placeholder provider success for email, SMS, push, Google Calendar, or Google Meet.

## 10. Deployment Readiness Checklist

- [ ] `.env` and `.env.*` are ignored.
- [ ] Uploaded files are ignored.
- [ ] `.env.example` files contain placeholders only.
- [ ] Aiven CA handling is documented.
- [ ] Production secrets are not committed.
- [ ] CORS origins match frontend/admin frontend origins.
- [ ] Cookie `secure` and `sameSite` behavior is documented for local and production.
- [ ] MySQL SSL is required for Aiven.
- [ ] Storage root is explicitly configured for production.
- [ ] Email/SMS provider disabled/manual mode is documented.
- [ ] Google Calendar disabled/manual mode is documented.
- [ ] Reminder processing command and cadence are documented.
- [ ] Backup and restore plan is documented outside source control.
- [ ] CSV exports are authorization-scoped.
- [ ] Audit logging is enabled for sensitive admin actions.

## 11. Known Limitations for Beta

- Email and SMS delivery remain disabled/manual unless real providers are configured.
- Google Calendar and Google Meet remain local/manual unless credentials are configured.
- Browser mutation automation is intentionally manual until disposable fixture creation and cleanup are automated.
- The smoke script is read-only by default and does not prove every mutation journey.
- Backups/restores depend on the Aiven operational plan and are not automated by this repo.
- Vite may warn about chunk size on build; that is a performance follow-up unless build fails.

## 12. Go/No-Go Criteria

### Go

- All four builds pass.
- Both health endpoints return ready with MySQL ready.
- `npm run smoke:beta` passes required read-only checks.
- Admin login and client login work with supplied QA credentials.
- Every manual end-to-end journey above passes using disposable data.
- No routed production page shows mock data as real state.
- No active button fakes success.
- No secrets are committed or printed.

### No-Go

- Any app fails to build.
- Backend or admin backend cannot reach MySQL.
- Admin login, forced password rotation, or protected route enforcement fails.
- CSRF can be bypassed for mutations.
- Cross-client access is possible for matters, billing, documents, or messages.
- Billing can over-allocate or misstate balances.
- Documents can be downloaded publicly or across clients.
- Reports KPIs do not match drilldown source data.
- Fake provider success is displayed for email, SMS, Google Calendar, or Google Meet.
