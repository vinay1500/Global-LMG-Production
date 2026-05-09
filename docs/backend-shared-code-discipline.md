# Backend Shared Code Discipline

Global LMG currently has two Node backends:

- `backend/` for the client-facing API.
- `admin_backend/` for admin operations.

Several low-level modules intentionally exist in both apps. For v1 launch, we are keeping
the duplicated files separate instead of introducing a monorepo shared package. This avoids
a risky late-stage repo restructuring while preserving the ability to patch and ship each
backend independently.

The tradeoff is drift risk. Any change to the concepts below must be reviewed as a paired
client/admin backend change unless there is a clear reason one backend should differ.

## Behaviorally Aligned Files

Keep these modules behaviorally aligned:

| Concept | Client backend | Admin backend |
| --- | --- | --- |
| MySQL pool and query helpers | `backend/src/lib/mysql.ts` | `admin_backend/src/lib/mysql.ts` |
| Cookies and session cookie flags | `backend/src/lib/httpCookies.ts` | `admin_backend/src/lib/httpCookies.ts` |
| HTTP error shape | `backend/src/lib/httpErrors.ts` | `admin_backend/src/lib/httpErrors.ts` |
| Idempotency | `backend/src/lib/idempotency.ts` | `admin_backend/src/lib/idempotency.ts` |
| Currency formatting | `backend/src/lib/currencyFormat.ts` | `admin_backend/src/lib/currencyFormat.ts` |
| Observability/logging | `backend/src/lib/observability.ts` | `admin_backend/src/lib/observability.ts` |
| Security event recording | `backend/src/lib/securityEvents.ts` | `admin_backend/src/lib/securityEvents.ts` |
| Sentry bootstrap | `backend/src/lib/sentry.ts` | `admin_backend/src/lib/sentry.ts` |
| Auth crypto helpers | `backend/src/lib/authCrypto.ts` | `admin_backend/src/lib/authCrypto.ts` |
| Persistent auth/rate limiting | `backend/src/modules/auth/persistentRateLimiter.ts` | `admin_backend/src/modules/auth/persistentRateLimiter.ts` |
| CSRF helpers | `backend/src/lib/csrf.ts` | `admin_backend/src/lib/csrf.ts` |
| Request IP/security helpers | `backend/src/lib/requestSecurity.ts` | `admin_backend/src/lib/requestSecurity.ts` |
| Provider HTTP timeout helpers | `backend/src/lib/providerHttp.ts` | `admin_backend/src/lib/providerHttp.ts` |
| Webhook security helpers | `backend/src/lib/webhookSecurity.ts` | `admin_backend/src/lib/webhookSecurity.ts` |
| Message content sanitation | `backend/src/lib/messageContent.ts` | `admin_backend/src/lib/messageContent.ts` |
| Email provider behavior | `backend/src/modules/auth/providers/email.ts` | `admin_backend/src/modules/providers/email.ts` |
| SMS provider behavior | `backend/src/modules/auth/providers/sms.ts` | `admin_backend/src/modules/providers/sms.ts` |

Names and public APIs do not need to be identical, because each backend has different route
and module boundaries. The behavior, safety defaults, error handling, timeout behavior, and
security posture should remain aligned.

## Patch Rules

When changing one duplicated concept:

1. Search both apps before editing.
   - Example: `rg "requireCsrf|csrf" backend/src admin_backend/src`
2. Patch both implementations or write down why only one backend needs the change.
3. Keep production defaults aligned unless the difference is deliberate and documented.
4. Preserve existing public response shapes unless the calling frontend is updated at the same time.
5. Do not copy secrets, provider keys, request bodies, passwords, tokens, or raw headers into logs.
6. Prefer the same test shape for both backends when the behavior is shared.
7. Run both backend typechecks/builds for shared concepts, even when only one file changed.

## Checklist By Change Type

- CSRF:
  - Update both `csrf.ts` files.
  - Verify mutation without CSRF fails in both APIs.
  - Verify sign-in/session bootstrap still sets the expected CSRF cookie/header flow.

- Cookies/sessions:
  - Update both `httpCookies.ts` files and any auth/session service touchpoints.
  - Confirm `Secure`, `SameSite`, domain, path, and max-age behavior in local and production envs.
  - Run admin and client sign-in smoke tests.

- Idempotency:
  - Update both `idempotency.ts` files when changing key, scope, fingerprint, conflict, or TTL behavior.
  - Test first call, replay, fingerprint conflict, and expired lock recovery.
  - Confirm payment and refund routes still preserve their response status codes.

- MySQL:
  - Update both `mysql.ts` files when changing pool config, timeouts, logging, or SSL behavior.
  - Confirm env examples and deployment docs still match the runtime config.
  - Run migrations only through the client backend migration command.

- Provider HTTP/email/SMS:
  - Update both provider HTTP helpers and the relevant email/SMS provider modules.
  - Do not add unsafe automatic retries for payment, email send, or SMS send operations.
  - Confirm timeouts do not log secrets or payload contents.

- Security events:
  - Update both `securityEvents.ts` files.
  - Safe helpers may catch errors, but they must log sanitized failure metadata.
  - Never log request bodies, passwords, OTPs, tokens, cookies, or raw provider signatures.

- Request IP / webhook allowlists:
  - Update both `requestSecurity.ts` and `webhookSecurity.ts` where applicable.
  - Use Express `req.ip` and documented trust-proxy behavior.
  - Keep provider signature verification mandatory even when IP allowlists are enabled.

- Currency formatting:
  - Update both `currencyFormat.ts` files.
  - Preserve USD as the official billing currency.
  - Local currency, if shown, must remain approximate display-only.

- Auth crypto:
  - Update both `authCrypto.ts` files when changing token generation, hashing, timing-safe comparison, or encryption.
  - Add tests for malformed input and length mismatch cases.

## Test Expectations

For any shared security, auth, provider, or idempotency change, run at minimum:

```bash
cd backend && npm run typecheck
cd admin_backend && npm run typecheck
cd backend && npm run build
cd admin_backend && npm run build
npm test
```

If frontend contracts or auth flows changed, also run:

```bash
cd frontend && npm run typecheck
cd admin_frontend && npm run typecheck
cd frontend && npm run build
cd admin_frontend && npm run build
```

For launch readiness changes, finish with:

```bash
npm run check:all
```

## Future Shared Package Plan

A `packages/shared` refactor is post-launch/v2 work. It should wait until the v1 production
surface is stable and the duplicated modules have settled.

When we do the refactor, start with pure, low-risk utilities:

1. `currencyFormat`
2. `messageContent`
3. `providerHttp`
4. `requestSecurity`
5. `webhookSecurity`

Defer higher-risk auth/session modules until there is a dedicated migration plan and
compatibility test suite for both backends:

1. `csrf`
2. `httpCookies`
3. `idempotency`
4. `authCrypto`
5. `securityEvents`
6. `persistentRateLimiter`

Until then, treat duplicated backend helper code as intentionally separate but operationally
paired.
