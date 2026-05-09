# Document Object Storage

Global LMG supports local document storage for development and S3-compatible object storage for staging/production.

## Environment

Use local storage for development:

```env
OBJECT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_ROOT=../storage/glmg-uploads
```

For early single-host launch, local storage is acceptable only when it uses an
absolute private path outside Git and release directories, with tested backups:

```env
OBJECT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_ROOT=/srv/global-lmg/shared/uploads
```

Set the same `DOCUMENT_STORAGE_ROOT` in both `backend` and `admin_backend`.
Do not use the development default `../storage/glmg-uploads` on production
hosts because PM2 runs from `/srv/global-lmg/current/backend` and
`/srv/global-lmg/current/admin_backend`; relative paths under `current` can be
confusing during rollback or release replacement.

Use S3-compatible storage for scalable deployments:

```env
OBJECT_STORAGE_DRIVER=s3
DOCUMENT_STORAGE_DRIVER=s3
S3_ENDPOINT=https://example-object-storage-endpoint
S3_REGION=auto
S3_BUCKET=global-lmg-documents
S3_ACCESS_KEY_ID=replace-with-access-key
S3_SECRET_ACCESS_KEY=replace-with-secret-key
S3_SESSION_TOKEN=
S3_VERIFY_UPLOAD_SHA256=true
```

Set these values in both `backend/.env` and `admin_backend/.env` when both apps need to upload, preview, or download documents.

Do not commit real access keys. Keep `.env` files ignored.

## Provider Notes

Hostinger Object Storage:

- Create a private bucket for documents.
- Use the endpoint, region, bucket, access key, and secret key from Hostinger.
- Keep the bucket private. The app serves files only after authentication and authorization.

Backblaze B2:

- Create an S3-compatible application key scoped to the document bucket.
- Use the S3 endpoint for the bucket region, for example `https://s3.us-west-004.backblazeb2.com`.
- Use the B2 region in `S3_REGION` if provided by B2.

Cloudflare R2:

- Create an R2 bucket and an API token with object read/write access to that bucket.
- Use the account endpoint, for example `https://<account-id>.r2.cloudflarestorage.com`.
- `S3_REGION=auto` is valid for R2.

## Behavior

- Upload content is still SHA-256 checked against the client-declared checksum before storage.
- With `S3_VERIFY_UPLOAD_SHA256=true`, the app reads the object back after upload and verifies the stored bytes.
- Preview/download stays authenticated through backend routes; no public object URLs are exposed.
- Audit events and document download logs continue to be written before file bytes are returned.
- Local storage remains the default, so development does not require object storage.

## Local Storage Operations

Local storage is private application storage, not a static web directory.

Recommended early-launch path:

```text
/srv/global-lmg/shared/uploads
```

This path is outside Git and outside immutable release directories. It should be
owned by the service user that runs both APIs and should not be world-readable:

```bash
sudo mkdir -p /srv/global-lmg/shared/uploads /srv/global-lmg/shared/backups/uploads
sudo chown -R global-lmg:global-lmg /srv/global-lmg/shared/uploads /srv/global-lmg/shared/backups
sudo chmod 0750 /srv/global-lmg/shared/uploads /srv/global-lmg/shared/backups
```

The Nginx samples do not serve this directory directly. `deploy/nginx/client-api.conf`
and `deploy/nginx/admin-api.conf` proxy only API routes to Node; document bytes
are returned only after backend authentication, authorization, malware-scan
policy checks, and audit logging. Do not add an Nginx `root` or `alias` for
`/srv/global-lmg/shared/uploads`.

### Backup

Run backups from the host. The command below creates a compressed archive with
numeric owners and same-filesystem traversal only:

```bash
sudo mkdir -p /srv/global-lmg/shared/backups/uploads
sudo tar --one-file-system --numeric-owner \
  -C /srv/global-lmg/shared \
  -czf /srv/global-lmg/shared/backups/uploads/uploads-$(date -u +%Y%m%dT%H%M%SZ).tar.gz \
  uploads
```

Copy the archive to encrypted off-host backup storage immediately after
creation. Keep upload backups access-restricted because they may contain client
documents and other personal data.

Optional rsync mirror to a mounted encrypted backup volume:

```bash
sudo rsync -aHAX --delete /srv/global-lmg/shared/uploads/ /mnt/global-lmg-backups/uploads-current/
```

### Restore

Stop the APIs before restoring so no process writes into the directory while the
archive is being expanded:

```bash
pm2 stop global-lmg-client-api global-lmg-admin-api
sudo mkdir -p /srv/global-lmg/shared/uploads
sudo tar --numeric-owner \
  -C /srv/global-lmg/shared \
  -xzf /srv/global-lmg/shared/backups/uploads/uploads-YYYYMMDDTHHMMSSZ.tar.gz
sudo chown -R global-lmg:global-lmg /srv/global-lmg/shared/uploads
sudo chmod 0750 /srv/global-lmg/shared/uploads
pm2 start global-lmg-client-api global-lmg-admin-api
```

After restore, run a smoke check with a disposable uploaded document:

1. Upload a small document.
2. Wait for malware scan completion or verify pending files are blocked.
3. Preview/download the document as the owning client or admin.
4. Confirm unauthorized users cannot access it.

### Cron Backup Suggestion

Install the backup as root or a dedicated backup user with read access to the
uploads directory. Use `flock` so backups do not overlap:

```cron
# Daily local upload backup at 01:20 UTC.
20 1 * * * root /usr/bin/flock -n /var/lock/global-lmg-upload-backup.lock /bin/sh -lc 'mkdir -p /srv/global-lmg/shared/backups/uploads && tar --one-file-system --numeric-owner -C /srv/global-lmg/shared -czf /srv/global-lmg/shared/backups/uploads/uploads-$(date -u +\%Y\%m\%dT\%H\%M\%SZ).tar.gz uploads'
```

For systemd, use a oneshot service that runs the same `tar` command and a
timer with `OnCalendar=*-*-* 01:20:00 UTC`. Add a second job to sync the archive
to encrypted off-host storage and alert if either step fails.

### Limits

Local storage is not suitable for multi-host API deployments. If there are two
or more backend/admin backend hosts, one host may write a file that another
host cannot read. Use S3-compatible storage before enabling horizontal app
scaling.

Migrate to S3-compatible storage when any of these are true:

- You run more than one API host or more than one region.
- Uploaded documents become business-critical enough to require managed object
  durability and lifecycle policies.
- Daily uploads or restore-time objectives outgrow host-level tar/rsync backups.
- You need object-level retention, server-side encryption controls, or easier
  disaster recovery.
- Manual backup monitoring becomes operationally noisy.

## Manual Test

1. Configure S3 variables in both backend env files.
2. Restart `backend` and `admin_backend`.
3. Upload a small disposable PDF as an admin document.
4. Preview the document in admin.
5. Download the document in admin.
6. If the document is client-visible, preview/download it from the client dashboard.
7. Confirm `document_versions.storage_driver_code = 's3'`.
8. Confirm recent `audit_events` and `document_download_logs` were written.

Return to local development by setting:

```env
OBJECT_STORAGE_DRIVER=local
DOCUMENT_STORAGE_DRIVER=local
```
