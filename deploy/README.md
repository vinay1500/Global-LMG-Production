# Global LMG Deployment Assets

These files are production samples only. Keep real `.env` files, service-account
keys, CA certificates, backups, and uploaded documents outside git.

## Files

- `pm2/ecosystem.config.cjs` starts the client API and admin API from built
  `dist/` output.
- `env/*.env.production.example` contains placeholder-only production env
  examples for the backend, admin backend, public frontend, and admin frontend.
- `cron/global-lmg.cron` installs v1 system-cron background jobs with `flock`
  locks for reminders, FX refresh, request/upload/document sweepers, and
  retention cleanup.
- `nginx/public-frontend.conf` serves the public/client frontend SPA.
- `nginx/client-api.conf` proxies the client API and Razorpay payment webhook to
  `127.0.0.1:3001`.
- `nginx/admin-frontend.conf` serves the admin frontend SPA.
- `nginx/admin-api.conf` proxies the admin API and provider webhooks to
  `127.0.0.1:3005`.

See `docs/deployment-env.md` for the required production variables and provider
mode rules. The example files contain placeholders only; never copy real server
env files back into git.

See `docs/monitoring-runbook.md` and `docs/monitoring-live-verification.md`
for Sentry/UptimeRobot setup and current live verification status.
See `docs/cron-background-jobs.md` for installing and monitoring production
cron jobs.
See `docs/vps-capacity-checklist.md` for the early-launch single-VPS sizing,
swap, PM2 memory limits, log rotation, alerts, and upgrade triggers.

If early launch uses local document storage to reduce cost, set both API env
files to the same private absolute path, for example:

```env
DOCUMENT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_ROOT=/srv/global-lmg/shared/uploads
```

Do not point local storage at a Git checkout or release directory. The Nginx
samples do not expose `/srv/global-lmg/shared/uploads`; keep it that way so all
document access continues through authenticated API routes. Follow
`docs/object-storage.md` for backup, restore, and migration-to-S3 criteria.

## Webhook IP Allowlists

The API Nginx samples include commented exact-location examples for optional
provider IP allowlists:

- Razorpay: `/api/v1/webhooks/razorpay` in `nginx/client-api.conf`
- Resend: `/api/v1/webhooks/resend` in `nginx/admin-api.conf`
- Twilio status callbacks: `/api/v1/webhooks/twilio/status` in
  `nginx/admin-api.conf`

Leave these blocks commented unless the current provider IP ranges have been
verified from the provider docs/dashboard and the operations owner is prepared
to keep them current. Signature verification in the app remains mandatory even
when Nginx allowlists are enabled. The app-level env allowlists
`RAZORPAY_WEBHOOK_IP_ALLOWLIST`, `RESEND_WEBHOOK_IP_ALLOWLIST`, and
`TWILIO_WEBHOOK_IP_ALLOWLIST` remain available as a second deployment control.

## Suggested Preflight

```bash
npm run validate:production-env -- \
  --backend-env /etc/global-lmg/backend.env \
  --admin-env /etc/global-lmg/admin_backend.env \
  --frontend-env /srv/global-lmg/current/frontend/.env.production \
  --admin-frontend-env /srv/global-lmg/current/admin_frontend/.env.production
```

Then build, migrate, start PM2, and run:

```bash
npm run smoke:deployment
```
