# Cron Background Jobs

Global LMG v1 production background work uses system cron plus `flock`.
This is intentionally simple: jobs are one-shot, idempotent, and protected
from overlapping runs. Do not add Redis/BullMQ for v1.

## Jobs

| Job | Schedule | Script | Log |
| --- | --- | --- | --- |
| Reminder processing | Every minute | `npm --prefix admin_backend run reminders:process` | `/var/log/global-lmg/reminders.log` |
| Pending document scan sweeper | Every 5 minutes | `npm --prefix backend run documents:expire-pending-scans` | `/var/log/global-lmg/document-scan-sweeper.log` |
| Stale payment draft cleanup | Every 10 minutes | `npm --prefix backend run requests:expire-payment-drafts` | `/var/log/global-lmg/sweep.log` |
| FX rate refresh | Daily at 02:00 UTC | `npm --prefix backend run fx:refresh` | `/var/log/global-lmg/fx.log` |
| Expired upload intent cleanup | Daily at 03:00 UTC | `npm --prefix backend run uploads:cleanup-expired` | `/var/log/global-lmg/uploads-cleanup.log` |
| Retention cleanup | Weekly Sunday at 04:00 UTC | `npm --prefix backend run cleanup:retention` | `/var/log/global-lmg/retention.log` |

## Script Audit

- `admin_backend/src/scripts/processReminders.ts`: locks and processes due reminders once.
- `backend/src/scripts/refreshFxRates.ts`: refreshes approximate display FX rates from the configured provider.
- `backend/src/scripts/expirePendingRequestDrafts.ts`: expires stale `draft_payment_pending` service requests and local gateway orders.
- `backend/src/scripts/cleanupExpiredUploadIntents.ts`: marks expired pending upload intents as `failed`.
- `backend/src/scripts/expirePendingDocumentScans.ts`: marks stale `pending_scan` document versions as `scan_failed`.
- `backend/src/scripts/cleanupRetention.ts`: deletes only eligible operational log/rate-limit/idempotency/auth-flow rows.

## Install

Create the log and lock directories:

```bash
sudo mkdir -p /var/log/global-lmg /var/lock/global-lmg
sudo chown -R global-lmg:global-lmg /var/log/global-lmg /var/lock/global-lmg
```

Install the cron file:

```bash
sudo cp /srv/global-lmg/current/deploy/cron/global-lmg.cron /etc/cron.d/global-lmg
sudo chmod 0644 /etc/cron.d/global-lmg
```

The sample cron file runs jobs as the `global-lmg` user. If production uses a
different deploy user, edit the user field before installing. The commands
source `/etc/global-lmg/backend.env` or `/etc/global-lmg/admin_backend.env`
inside the locked process; do not print those files or copy them into git.

## Locking

Each job uses its own non-blocking `flock` file in `/var/lock/global-lmg`.
If a previous run is still active, cron skips the next run instead of starting
an overlapping copy.

## Retention Rules

The retention cleanup is intentionally conservative:

- `security_events`: keep 1 year.
- `audit_events`: keep 1 year.
- `email_events` and `sms_events`: keep 90 days.
- completed `idempotency_keys`: keep 7 days.
- expired `rate_limit_buckets`: delete after the reset window and block window have passed.
- consumed or expired auth flows and verification/reset tokens: keep 30 days.

The cleanup does not delete client matters, documents, invoices, payments,
messages, or request records.

## Provider Event Payload Minimization

Resend and Twilio webhook rows are retained only for operational delivery
support: bounce/complaint/failure triage, webhook replay deduplication, and
provider incident investigation. The app stores explicit provider identifiers,
event type/status, received timestamps, and the minimum recipient fields needed
for support. `payload_json` is a minimized diagnostic snapshot, not the raw
provider payload; it masks recipient email/phone values and omits message
subjects, bodies, headers, and broad provider metadata.

Provider event rows can still contain PII in direct columns such as
`recipient_email`, `to_phone`, and `from_phone`. Production MySQL and backups
are expected to be encrypted at rest by the managed database/storage provider.
The weekly retention job deletes `email_events` and `sms_events` older than 90
days and should be monitored through `/var/log/global-lmg/retention.log`.

## Manual Runs

Run these from `/srv/global-lmg/current`:

```bash
set -a; . /etc/global-lmg/admin_backend.env; set +a
npm --prefix admin_backend run reminders:process
```

```bash
set -a; . /etc/global-lmg/backend.env; set +a
npm --prefix backend run fx:refresh
npm --prefix backend run requests:expire-payment-drafts
npm --prefix backend run uploads:cleanup-expired
npm --prefix backend run documents:expire-pending-scans
npm --prefix backend run cleanup:retention
```

## Monitoring

Check logs:

```bash
tail -n 200 /var/log/global-lmg/reminders.log
tail -n 200 /var/log/global-lmg/fx.log
tail -n 200 /var/log/global-lmg/sweep.log
tail -n 200 /var/log/global-lmg/uploads-cleanup.log
tail -n 200 /var/log/global-lmg/document-scan-sweeper.log
tail -n 200 /var/log/global-lmg/retention.log
```

Alert when:

- reminder cron does not produce output for 5 minutes.
- any job logs a failure event.
- document scan failures spike while `FILE_SCAN_MODE=clamav`.
- stale `draft_payment_pending` requests continue growing after cleanup runs.

## Verification Drills

1. Create a disposable due reminder and confirm it is processed within about 1 minute.
2. Create a disposable stale `draft_payment_pending` request and confirm cleanup marks it `lost-closed`.
3. Create an expired pending upload intent and confirm cleanup marks it `failed`.
4. Create a stale `pending_scan` document version and confirm the sweeper marks it `scan_failed`.
5. Insert old test rows for idempotency/rate-limit/provider event tables and confirm retention deletes only eligible rows.

## Incident Disable

Disable all jobs during an incident:

```bash
sudo mv /etc/cron.d/global-lmg /etc/cron.d/global-lmg.disabled
```

Re-enable after the incident:

```bash
sudo mv /etc/cron.d/global-lmg.disabled /etc/cron.d/global-lmg
```
