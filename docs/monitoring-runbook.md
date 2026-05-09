# Monitoring Runbook

Last updated: 2026-05-07

Scope: Global LMG public frontend, client API, admin frontend, admin API, reminder processing, provider delivery, logs, and incident alerting.

## Monitoring Goals

1. Detect full outage within 2 minutes.
2. Detect degraded API/database readiness within 5 minutes.
3. Detect reminder/provider failures before clients are affected.
4. Keep enough logs and event trails for incident reconstruction without storing secrets.

For early single-VPS launch sizing, swap, PM2 memory restart limits, host
resource alerts, and upgrade triggers, see `docs/vps-capacity-checklist.md`.

## UptimeRobot

Current live status:

- UptimeRobot API credentials were not present in local ignored env/credentials during the 2026-05-07 verification pass.
- Monitors still need to be created or confirmed in the UptimeRobot dashboard.
- Alert contacts still need dashboard confirmation.

Create monitors:

| Monitor | URL | Interval | Expected |
| --- | --- | ---: | --- |
| Public frontend | `https://www.globallmg.org/` | 1 minute | HTTP 200 and HTML shell |
| Client API live | `https://api.globallmg.org/api/v1/health/live` | 1 minute | HTTP 200 |
| Client API ready | `https://api.globallmg.org/api/v1/health/ready` | 1 minute | HTTP 200 with MySQL ready |
| Admin frontend | `https://admin.globallmg.org/login` | 1 minute | HTTP 200 and HTML shell |
| Admin API live | `https://admin-api.globallmg.org/api/v1/admin/health/live` | 1 minute | HTTP 200 |
| Admin API ready | `https://admin-api.globallmg.org/api/v1/admin/health/ready` | 1 minute | HTTP 200 with MySQL/schema ready |

Alert contacts:

- Primary: operations owner
- Secondary: engineering owner
- Escalation: business owner

Dashboard setup steps:

1. Create or open the Global LMG UptimeRobot account.
2. Add alert contacts for operations, engineering, and business escalation.
3. Create the six monitors listed above.
4. Use 60-second intervals for live/ready endpoints if the account plan allows it.
5. Enable alerts for each monitor and send a test alert to every contact.
6. Record monitor IDs and alert contact IDs in the deployment notes, not in source code.
7. Confirm each monitor is green for at least 10 minutes before launch sign-off.

Alert rules:

- 1 failed check: warn in operations channel.
- 2 consecutive failed checks: page primary owner.
- 5 minutes degraded: open incident record.

## Host Resource Alerts

Configure VPS-level alerts in the hosting dashboard or a lightweight agent:

| Signal | Threshold | Action |
| --- | ---: | --- |
| CPU | > 80% for 10 minutes | Inspect PM2, ClamAV, cron overlap, slow queries |
| RAM | > 80% for 10 minutes | Check PM2 RSS, ClamAV RSS, swap use |
| Swap | > 25% for 10 minutes | Treat as RAM pressure warning |
| Disk | > 75% used | Rotate logs, prune backups, expand disk, or move uploads to S3 |
| API health | 2 consecutive failures | Page primary owner |
| Reminder cron | no successful run for 5 minutes | Check cron logs and lock files |

The lean launch target is one VPS with Nginx, PM2, static frontends, client API,
admin API, ClamAV, cron jobs, and Aiven MySQL. Minimum and recommended specs
are documented in `docs/vps-capacity-checklist.md`.

## Sentry

Current live status:

- App-side Sentry SDK wiring is present for both APIs and both frontends.
- Local Sentry org/project credentials and DSNs were not present during the 2026-05-07 verification pass.
- `npm run smoke:sentry` will send safe backend smoke events when backend/admin backend DSNs are configured; otherwise it reports `skipped`.

Recommended projects:

- `global-lmg-client-api`
- `global-lmg-admin-api`
- `global-lmg-frontend`
- `global-lmg-admin-frontend`

Required tags:

- `environment`
- `release`
- `service`
- `requestId` when available

Required env:

Client API:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_RELEASE=<git-sha-or-release-version>`
- `SENTRY_TRACES_SAMPLE_RATE=0.05`

Admin API:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT=production`
- `SENTRY_RELEASE=<git-sha-or-release-version>`
- `SENTRY_TRACES_SAMPLE_RATE=0.05`

Public frontend:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT=production`
- `VITE_SENTRY_RELEASE=<git-sha-or-release-version>`
- `VITE_SENTRY_TRACES_SAMPLE_RATE=0.05`

Admin frontend:

- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT=production`
- `VITE_SENTRY_RELEASE=<git-sha-or-release-version>`
- `VITE_SENTRY_TRACES_SAMPLE_RATE=0.05`

Dashboard setup steps:

1. Create projects:
   - `global-lmg-client-api`
   - `global-lmg-admin-api`
   - `global-lmg-frontend`
   - `global-lmg-admin-frontend`
2. Copy the DSN for each project into the matching production env file.
3. Set `SENTRY_RELEASE` or `VITE_SENTRY_RELEASE` to the deployed git SHA or release tag.
4. Deploy/restart APIs and rebuild/redeploy frontends.
5. Run `npm run smoke:sentry` for backend smoke events.
6. For frontends, open the deployed public and admin apps and verify the release/environment appears in Sentry.
7. Confirm safe test events arrive and no request bodies, cookies, tokens, document contents, or provider credentials are present.

Do not send:

- passwords
- session cookies
- CSRF tokens
- provider API keys
- document contents
- raw uploaded files
- private Google service account keys

Minimum alert rules:

| Alert | Threshold | Action |
| --- | --- | --- |
| New high-severity backend error | first occurrence in production | Notify engineering |
| Error rate spike | > 2% requests for 5 minutes | Open incident |
| Auth/security event spike | > baseline for 10 minutes | Security review |
| Provider delivery failures | > 5 failures in 15 minutes | Provider triage |

## PM2 Logs

Useful commands:

```bash
pm2 status
pm2 logs global-lmg-client-api --lines 200
pm2 logs global-lmg-admin-api --lines 200
pm2 describe global-lmg-client-api
pm2 describe global-lmg-admin-api
pm2 monit
```

Structured log expectations:

- request id
- method/path/status
- response time
- client IP via trusted proxy headers
- user agent
- error code without secret payloads

Log locations depend on PM2 configuration. If using default PM2:

```bash
~/.pm2/logs/global-lmg-client-api-out.log
~/.pm2/logs/global-lmg-client-api-error.log
~/.pm2/logs/global-lmg-admin-api-out.log
~/.pm2/logs/global-lmg-admin-api-error.log
```

Retention:

- Install `pm2-logrotate`.
- Keep at least 14 days in beta and 30 days in production.
- Ship logs to a central store when public traffic begins.

## Cron Background Job Logs

Production background jobs are installed from `deploy/cron/global-lmg.cron`.
See `docs/cron-background-jobs.md` for schedules, lock files, install steps,
manual commands, and verification drills.

Reminder processor command:

```bash
cd /srv/global-lmg/current
set -a; . /etc/global-lmg/admin_backend.env; set +a
npm --prefix admin_backend run reminders:process
```

Cron commands use `flock` to prevent overlapping runs. Reminder output goes to:

```bash
/var/log/global-lmg/reminders.log
```

What success looks like:

```json
{"event":"reminders.processed","locked":0,"processed":0,"failed":0}
```

Alert conditions:

- Cron does not run for 5 minutes.
- `reminders.processing_failed` appears.
- `failed` count is greater than 0 for 3 consecutive runs.
- Admin Reports `failed-reminders` drilldown is non-zero for more than 15 minutes.

Manual checks:

```bash
tail -n 200 /var/log/global-lmg/reminders.log
tail -n 200 /var/log/global-lmg/fx.log
tail -n 200 /var/log/global-lmg/sweep.log
tail -n 200 /var/log/global-lmg/uploads-cleanup.log
tail -n 200 /var/log/global-lmg/document-scan-sweeper.log
tail -n 200 /var/log/global-lmg/retention.log
```

## Provider Failure Monitoring

Resend:

- Monitor `email_events` for bounced, complained, failed, and delivery-delayed states.
- `email_events.payload_json` is intentionally minimized and retained for 90
  days only. Use explicit columns such as provider event/message id, status,
  received timestamp, and recipient email for operational triage.
- Monitor audit events:
  - `invoice.email_failed`
  - `invoice.email_skipped_manual_mode`
  - reminder email failures
- Confirm webhook monitor reaches `/api/v1/webhooks/resend`.

Twilio:

- Monitor `sms_events` for failed and undelivered states.
- `sms_events.payload_json` is intentionally minimized and retained for 90
  days only. It should not contain raw SMS body content; use provider message
  id, delivery status, error code/message, and phone columns for support.
- Monitor reminder SMS failure reason text.
- Confirm webhook monitor reaches `/api/v1/webhooks/twilio/status`.

Google Calendar/Meet:

- Monitor event fields:
  - `calendar_sync_status_code=failed`
  - `calendar_sync_error_text`
- Audit events:
  - `event.calendar_sync_failed`
  - `event.calendar_sync_retried`

ClamAV:

- Monitor scan statuses:
  - `scan_failed`
  - `infected`
  - `scan_skipped_manual_mode`
- If `FILE_SCAN_MODE=clamav`, alert when ClamAV port is unreachable.

## Daily Operations Checklist

1. Check UptimeRobot dashboard for outages/degradation.
2. Check Sentry unresolved production issues.
3. Check PM2 status for restarts/memory pressure.
4. Check reminder cron log for failures.
5. Check failed reminder report.
6. Check provider event queues for failures.
7. Check Aiven CPU/storage/connection graphs.

## Incident Triage

Severity levels:

| Severity | Criteria | Response |
| --- | --- | --- |
| SEV1 | Client/admin API unavailable, data loss risk, auth broken | Page immediately, open incident, freeze deploys |
| SEV2 | Major workflow degraded: billing, documents, messages, events | Respond within 30 minutes |
| SEV3 | Provider degraded with manual workaround | Respond same business day |
| SEV4 | Cosmetic or isolated non-critical error | Backlog or next release |

First 10 minutes:

1. Confirm whether issue affects frontend, API, DB, provider, or network.
2. Check health endpoints.
3. Check PM2 status and recent logs.
4. Check Aiven service status.
5. Check latest deployment timestamp.
6. Assign incident commander and scribe for SEV1/SEV2.

Do not:

- Restart repeatedly without reading logs.
- Run destructive SQL.
- Rotate secrets during incident unless compromise is suspected.
- Claim provider delivery succeeded unless provider status confirms it.

## Post-Incident Review

Record:

- timeline
- impact
- root cause
- detection source
- customer-visible symptoms
- data integrity impact
- actions taken
- follow-up owners and dates
