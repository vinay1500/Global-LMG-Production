# Aiven Backup and Restore Runbook

Last updated: 2026-05-09

Scope: MySQL data for Global LMG client API and admin API. This runbook covers Aiven-managed backups, point-in-time recovery, test restores, verification, and recovery objectives. Do not store database passwords, CA certificates, dumps, or restore artifacts in git.

## Recovery Objectives

| Environment | RPO | RTO | Notes |
| --- | ---: | ---: | --- |
| Controlled beta | 24 hours | 4 hours | Manual intervention acceptable if communicated. |
| Production | 1 hour or Aiven PITR granularity, whichever is stricter | 2 hours | Requires rehearsed restore and DNS/app env switch procedure. |
| Major incident with data corruption | Last verified clean restore point | 4-8 hours | Requires incident commander approval before destructive action. |

## Backup Schedule

1. Use Aiven automated backups and PITR for the production MySQL service.
2. Confirm backup retention in the Aiven Console before launch.
   Recommended minimum: 7 days for beta, 14-30 days for public production.
3. Take an explicit Aiven service backup or manual logical dump before every production release that includes migrations.
4. Keep manual logical dumps encrypted and outside the repo, for example:
   - `/secure-backups/global-lmg/mysql/YYYY-MM-DD/`
   - private object storage bucket with server-side encryption
5. Never put backups under `backups/db/` unless that local path remains ignored and is used only temporarily.

## Pre-Release Backup

Before running production migrations:

```bash
# Use an ignored option file, never inline secrets.
mysqldump --defaults-extra-file=/secure/global-lmg/prod-mysql.cnf \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --databases defaultdb \
  > /secure-backups/global-lmg/mysql/$(date -u +%Y%m%dT%H%M%SZ)-defaultdb.sql
```

The MySQL option file should include host, port, user, password, SSL mode, and CA path. Do not print or commit it.

## Aiven PITR Restore to Test Service

Preferred restore drill path:

1. In Aiven Console, open the production MySQL service.
2. Select backups / restore.
3. Choose a restore point from before the release or drill timestamp.
4. Restore to a new test service, not the production service.
5. Name it clearly, for example `global-lmg-restore-drill-YYYYMMDD`.
6. Wait for Aiven to report the restored service as running.
7. Create temporary app credentials for the restored service if needed.
8. Set temporary local env files outside git:
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_DATABASE`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`
   - `MYSQL_SSL_MODE=REQUIRED`
   - `MYSQL_SSL_CA_PATH`
9. Run schema and health verification against the restored service.
10. Destroy the restored test service after sign-off unless it is needed for investigation.

CLI equivalent, if the Aiven CLI is installed and authenticated:

```bash
# Example only. Confirm exact service/project names in Aiven first.
command -v aiven
aiven service list
aiven service get <prod-mysql-service>
aiven service create global-lmg-restore-drill-YYYYMMDD \
  --service-type mysql \
  --cloud <same-cloud-region> \
  --plan <restore-plan> \
  --project <project-name> \
  --restore-from <prod-mysql-service> \
  --backup-name <backup-or-pitr-target>
```

Use the Aiven documentation for the current CLI restore flags because they can vary by service and account configuration.

## Table-Count Verification

Run read-only checks against production before restore and restored test service after restore. Compare counts and critical recency.

```sql
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'client_accounts', COUNT(*) FROM client_accounts
UNION ALL SELECT 'matters', COUNT(*) FROM matters
UNION ALL SELECT 'service_requests', COUNT(*) FROM service_requests
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'invoice_lines', COUNT(*) FROM invoice_lines
UNION ALL SELECT 'documents', COUNT(*) FROM documents
UNION ALL SELECT 'document_versions', COUNT(*) FROM document_versions
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'conversation_threads', COUNT(*) FROM conversation_threads
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'event_reminders', COUNT(*) FROM event_reminders
UNION ALL SELECT 'audit_events', COUNT(*) FROM audit_events
UNION ALL SELECT 'security_events', COUNT(*) FROM security_events;
```

Critical integrity checks:

```sql
SELECT MAX(created_at) AS newest_user FROM users;
SELECT MAX(created_at) AS newest_invoice FROM invoices;
SELECT MAX(created_at) AS newest_document_version FROM document_versions;
SELECT MAX(occurred_at) AS newest_audit_event FROM audit_events;
SELECT COUNT(*) AS applied_migrations FROM schema_migrations;
```

Schema migration check:

```sql
SELECT id, checksum, executed_at
FROM schema_migrations
ORDER BY executed_at DESC
LIMIT 10;
```

## App Health Verification

Point a temporary staging deployment or local env at the restored test service, then run:

```bash
npm run validate:production-env -- \
  --backend-env /secure/global-lmg/restore-backend.env \
  --admin-env /secure/global-lmg/restore-admin-backend.env \
  --frontend-env frontend/.env.example \
  --admin-frontend-env admin_frontend/.env.example

npm --prefix backend run build
npm --prefix admin_backend run build
npm run smoke:deployment
```

Manual read-only checks:

1. Client API `/api/v1/health/ready` returns `status=ok`.
2. Admin API `/api/v1/admin/health/ready` returns `status=ok`.
3. Admin login works with a controlled restored admin account.
4. Client dashboard loads for a controlled restored test client.
5. Billing, documents, messages, events, and settings pages load without write operations.
6. Document preview/download authorization still blocks unauthenticated access.

## Production Restore Decision

Only restore or switch production traffic after:

1. Incident commander approves.
2. Backup timestamp and expected data loss window are documented.
3. Legal/operations owner approves if client-visible data may be lost.
4. Current production service is snapshotted before any destructive action.
5. Restored service passes table-count and app health checks.
6. Rollback communication is ready for internal team and affected clients.

## Restore Drill Record

Date: 2026-05-09

Result: Blocked before live Aiven restore; no provider infrastructure was
created, mutated, or destroyed.

What was checked:

- Local Aiven CLI commands `aiven` and `avn` were not installed or not on
  `PATH`.
- No Aiven Console session, project name, source service name, or disposable
  restore target was available in the workspace context.
- The currently configured MySQL service was reachable for read-only checks.
- `SHOW VARIABLES LIKE 'max_connections'` returned `76` for the currently
  configured MySQL service.
- Current example pool sizing of one client API instance plus one admin API
  instance at `MYSQL_CONNECTION_LIMIT=20` each reserves 40 app connections,
  below the 70% budget of 53 connections for this service.
- No restore was attempted because creating an Aiven restore target requires an
  authenticated operator and an explicitly disposable service target.

Next required action:

1. Confirm the launch source service name and Aiven project in the Console.
2. Install/authenticate Aiven CLI, or run the restore through Aiven Console.
3. Create a disposable restore target from a recent backup/PITR point.
4. Connect with temporary env files outside git.
5. Run the table-count and app health verification above.
6. Destroy the restore target and record RTO/RPO here.

Date: 2026-05-07

Result: Blocked before live Aiven restore.

What was checked:

- `mysql` client is installed locally.
- `mysqldump` is installed locally.
- `aiven` CLI is not installed on this workstation.
- No Aiven project/service identifier or dedicated staging restore target was available in the repo or active shell context.
- No live restore was attempted, to avoid mutating provider infrastructure without explicit Aiven access and target confirmation.

Next required action:

1. Create or identify a disposable Aiven staging restore target.
2. Install/authenticate Aiven CLI or use Aiven Console with an operator account.
3. Restore production or staging backup to the disposable test service.
4. Run the table-count and app health verification above.
5. Record the completed drill result here with timestamps, source backup, restored service name, row-count deltas, health check output, and cleanup confirmation.

Completion template:

```text
Date:
Operator:
Source service:
Restore target:
Restore point:
Started at UTC:
Ready at UTC:
Table-count result:
App health result:
Issues found:
Target destroyed at UTC:
RTO observed:
RPO observed:
Sign-off:
```
