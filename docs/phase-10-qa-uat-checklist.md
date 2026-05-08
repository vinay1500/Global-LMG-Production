# Phase 10 QA/UAT Checklist

This checklist is grounded in the routes, modules, and live data flows that exist in this repo as of 2026-04-18.

## Scope

- Client frontend entry: `frontend/src/app/App.tsx`
- Admin frontend entry: `admin_frontend/src/app/router.tsx`
- Client API surface: `backend/src/routes/index.ts`
- Admin API surface: `admin_backend/src/routes/index.ts`

## Environment Preflight

Run these before browser testing:

1. Start the four apps in development mode.
   - `backend`: `APP_ENV=development PUBLIC_WEB_ORIGIN=http://127.0.0.1:5173 DOCUMENT_STORAGE_ROOT=var/uploads npm run dev`
   - `admin_backend`: `APP_ENV=development PUBLIC_ADMIN_WEB_ORIGIN=http://127.0.0.1:5174 npm run dev`
   - `frontend`: `npm run dev`
   - `admin_frontend`: `npm run dev`
2. Confirm the expected ports are listening.
   - Client API: `3001`
   - Admin API: `3005`
   - Client web: `5173`
   - Admin web: `5174`
3. Confirm MySQL is reachable from the machine running the apps.
   - The client backend requires MySQL during bootstrap and will not bind `3001` if schema warmup fails.
4. Confirm document storage is writable.
   - Local dev expectation: `DOCUMENT_STORAGE_ROOT=var/uploads`
5. Run the scripted read-path smoke pass once the stack is up.
   - `node scripts/phase10-smoke.mjs`

## Staging Playwright E2E Runner

Use `scripts/run-e2e-staging.mjs` to start all four local/staging app
processes, wait for readiness, run Playwright, and tear down the processes
afterward. The runner is intended for disposable staging data only.

Create a local `.env.e2e.staging` file at the repo root. This file is ignored
by git and must never be committed.

Required variables:

```env
E2E_RUN_MUTATIONS=false
E2E_CLIENT_WEB_BASE=http://127.0.0.1:5173
E2E_ADMIN_WEB_BASE=http://127.0.0.1:5174
E2E_CLIENT_API_BASE=http://127.0.0.1:3001/api/v1
E2E_ADMIN_API_BASE=http://127.0.0.1:3005/api/v1/admin
E2E_ADMIN_EMAIL=<disposable-admin-email>
E2E_ADMIN_PASSWORD=<disposable-admin-password>
E2E_CLIENT_EMAIL=<disposable-client-email>
E2E_CLIENT_PASSWORD=<disposable-client-password>
E2E_ALLOW_PRODUCTION_TARGET=false
```

If the component `.env` files are not already configured, also provide the
required app/database env in `.env.e2e.staging`, for example:

```env
APP_ENV=development
MYSQL_HOST=<staging-or-local-mysql-host>
MYSQL_PORT=3306
MYSQL_DATABASE=<disposable-test-database>
MYSQL_USER=<database-user>
MYSQL_PASSWORD=<database-password>
MYSQL_SSL_MODE=DISABLED
DOCUMENT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_ROOT=var/uploads
EMAIL_PROVIDER_MODE=disabled
SMS_PROVIDER_MODE=disabled
GOOGLE_AUTH_MODE=disabled
CALENDAR_SYNC_MODE=disabled
FILE_SCAN_MODE=disabled
```

Run:

```bash
node scripts/run-e2e-staging.mjs
```

Safety notes:

- Use disposable admin/client credentials only.
- Keep `E2E_RUN_MUTATIONS=false` for read-only auth checks.
- Use `E2E_RUN_MUTATIONS=true` only against disposable staging databases.
- Do not run mutation tests against production.
- If any target URL looks production-like, the runner refuses to continue
  unless `E2E_ALLOW_PRODUCTION_TARGET=true` is set explicitly.
- The runner sets `E2E_RUN_LIVE=true` for Playwright automatically.

Readiness checks:

- Client API: `${E2E_CLIENT_API_BASE}/health/ready`
- Admin API: `${E2E_ADMIN_API_BASE}/health/ready`
- Client frontend: `${E2E_CLIENT_WEB_BASE}`
- Admin frontend: `${E2E_ADMIN_WEB_BASE}/login`

Troubleshooting:

- Port already in use: stop the existing process or change the matching base URL
  port in `.env.e2e.staging`.
- Health endpoint timeout: confirm MySQL is reachable and migrations have run.
- Invalid credentials: recreate/reset the disposable smoke identities and update
  only the ignored env file.
- Secure-cookie issues on HTTP local staging: use `APP_ENV=development` for local
  HTTP rehearsal, or test over HTTPS when using production-like cookie settings.
- DB/migration readiness: run backend migrations before the E2E runner, then
  confirm both `/health/ready` endpoints return `200`.

## Known Blockers

### Blocker 1: Client backend bootstrap depends on live MySQL reachability

- Symptom: `backend` exits before binding `3001`
- Current observed failure during Phase 10 startup:
  - `getaddrinfo ENOTFOUND <configured-mysql-host>`
- Impact:
  - Client login
  - client dashboard
  - uploads
  - notifications
  - package selection
- Status: open environment blocker

## Admin Smoke Checklist

Source of truth: `admin_frontend/src/app/router.tsx`

### Auth and shell

- [ ] `GET /login` renders the admin login page
- [ ] Valid admin login reaches `/dashboard`
- [ ] Invalid login shows an auth error without blanking the page
- [ ] Sign-out returns to `/login`

### Dashboard

- [ ] `/dashboard` loads live metrics from `admin_backend`
- [ ] KPI cards show real values, not seed placeholders
- [ ] Recent audit and notification widgets render without fake data

### Clients

- [ ] `/clients` loads live client rows
- [ ] Clicking a client opens `/clients/:clientId`
- [ ] Client detail loads contact, matters, and billing context from live APIs

### Matters

- [ ] `/matters` loads live matter rows
- [ ] Clicking a matter stays on `/matters/:matterId`
- [ ] Matter detail loads assignments, documents, messages, billing, package workspace, and timeline from live APIs
- [ ] Stage update persists and survives refresh
- [ ] Assignment create/update persists and writes audit
- [ ] Note/update creation persists and survives refresh

### Package workflow

- [ ] Matter package workspace loads draft, active proposal, history, selected package, and linked invoice state
- [ ] Save draft persists package rows, services, and features
- [ ] Publish proposal creates a client-visible proposal state
- [ ] Recommended package state is preserved after refresh
- [ ] Override selected package enforces billing rules and writes audit

### Documents

- [ ] `/documents` loads live document rows
- [ ] Document visibility changes persist
- [ ] Document review status changes persist
- [ ] Client-visible document changes are reflected in the client portal after refresh

### Messages

- [ ] `/messages` loads live threads and unread counts
- [ ] Admin reply persists in the thread
- [ ] Reply updates client inbox/unread state after refresh

### Meetings

- [ ] `/meetings` loads live event rows
- [ ] Event creation persists and appears after refresh
- [ ] Event changes appear in the client upcoming-events view after refresh

### Billing and refunds

- [ ] `/billing` loads live invoices, payments, and refunds
- [ ] Draft invoice creation persists
- [ ] Send invoice moves invoice state as expected
- [ ] Send reminder creates a client notification
- [ ] Refund creation persists and appears after refresh

### Notifications and audit

- [ ] `/notifications` loads live notification rows
- [ ] `/audit` loads live audit events, not seed entries
- [ ] Critical admin mutations write corresponding audit events

### RBAC

- [ ] Non-admin user is blocked from admin routes
- [ ] Role-restricted actions fail cleanly with authorization errors

## Client Smoke Checklist

Source of truth: `frontend/src/app/App.tsx`

### Auth

- [ ] Public site renders at `/`
- [ ] Sign-in modal opens from brochure shell
- [ ] Valid client login reaches `/dashboard`
- [ ] Invalid login shows error without breaking the shell
- [ ] Sign-out returns to the brochure view

### Dashboard shell

- [ ] `/dashboard` loads for authenticated users only
- [ ] Matters, billing, documents, notifications, and messages render from live snapshot data
- [ ] Empty states render intentionally where data is absent

### Matter package UX

- [ ] Published packages render in the matter detail flow
- [ ] Recommended package badge renders correctly
- [ ] Selected package state renders correctly
- [ ] Package selection calls the live package-selection API
- [ ] Package selection produces an invoice visible in billing after refresh

### Client document, event, and message sync

- [ ] Document visibility changes from admin are reflected after refresh
- [ ] Admin-created events appear in upcoming events after refresh
- [ ] Admin replies appear in client messaging and unread counts update

### Billing and notifications

- [ ] Invoice send/remind actions appear in client billing and notifications
- [ ] Refund and payment status changes are reflected correctly in billing views
- [ ] Notification dismissal/read state persists

## UAT Critical Journeys

### Journey 1: Admin auth and shell stability

- [ ] Admin login
- [ ] Visit dashboard, clients, matters, messages, documents, meetings, billing, notifications, audit
- [ ] No blank pages, redirect loops, or route resets

### Journey 2: Matter operations

- [ ] Open a matter
- [ ] Change stage
- [ ] Update assignment
- [ ] Add note/update
- [ ] Verify audit entry

### Journey 3: Package to invoice loop

- [ ] Admin creates package draft
- [ ] Admin publishes proposal
- [ ] Client sees published proposal
- [ ] Client selects package
- [ ] Invoice is generated and visible
- [ ] Matter operational status updates correctly
- [ ] Audit and notifications are present on both sides where expected

### Journey 4: Document and message loop

- [ ] Admin changes document visibility/review
- [ ] Client sees document change
- [ ] Admin replies in thread
- [ ] Client sees reply and unread state update

### Journey 5: Event and billing loop

- [ ] Admin creates event
- [ ] Client sees event
- [ ] Admin sends invoice/reminder
- [ ] Client sees billing update and notification
- [ ] Admin creates refund
- [ ] Client billing reflects refund state

## Deferred Modules

Source of truth: `admin_frontend/src/app/router.tsx`

These should remain clearly deferred during Phase 10 and should not be counted as blockers unless they appear fake-live:

- `/requests`
- `/tasks`
- `/reports`
- `/settings`

## Exit Criteria

Phase 10 is complete when:

- All critical journeys above pass on desktop
- Critical client/admin loops are synchronized through live data
- Every failed item is labeled either `blocker` or `post-launch`
- No critical screen depends on fake seed data for visible operational work
