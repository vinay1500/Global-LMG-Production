# ClamAV Deployment and Live Scan Checklist

Global LMG document upload scanning uses ClamAV over the TCP `INSTREAM` protocol. The scanner is a real provider; the UI must only show `clean` after ClamAV actually returns `OK`.

Uploads are intentionally asynchronous. The backend stores the uploaded file and document metadata first, marks the document version as `pending_scan`, and returns the upload response without waiting for ClamAV. A background task then reads the stored file/object and updates the version to `clean`, `infected`, `scan_failed`, or `scan_skipped_manual_mode`. In production and staging, pending files remain blocked from preview and download until they become `clean`.

## Local Docker Setup

Docker is the preferred portable setup because the same service definition can be moved to hosting.

```bash
docker compose -f docker-compose.clamav.yml up -d
npm run smoke:clamav
```

For local development where the Node backends run on the host and ClamAV runs in Docker:

```env
FILE_SCAN_MODE=clamav
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
FILE_SCAN_PENDING_TIMEOUT_MINUTES=5
FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN=true
FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN=true
```

In `APP_ENV=development`, these block flags remain env-configurable for local troubleshooting. In every non-development environment, both preview and download blocking are forced on at runtime even if an env file accidentally sets either value to `false`.

## Hosting Setup

If the backend and ClamAV run inside the same Docker Compose network, use the service name instead of localhost:

```env
FILE_SCAN_MODE=clamav
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
FILE_SCAN_PENDING_TIMEOUT_MINUTES=5
FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN=true
FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN=true
```

Deploy `docker-compose.clamav.yml` beside the backend service or merge its `clamav` service into the hosting compose file. Keep the `clamav-db` volume so virus definitions survive container restarts.

## Pending Scan Sweeper

If a backend process exits while a background scan is running, a document version can remain `pending_scan`. Run the sweeper from cron or the process manager every few minutes:

```bash
npm run documents:expire-pending-scans
```

The command marks `pending_scan` rows older than `FILE_SCAN_PENDING_TIMEOUT_MINUTES` as `scan_failed` with the safe error text `Scan did not complete in time.` It does not delete files, and it never marks stale rows as clean or infected.

## V2 Queue Plan

The current v1 implementation is an in-process fire-and-forget worker. It is intentionally simple and safe because preview/download gates already block pending files. A later v2 can move scanning into a durable queue such as BullMQ/Redis so scans survive process restarts without relying on the sweeper.

## Live Scan Checklist

1. Start the `clamav` service.
2. Wait for the health check to pass. Initial virus definition download can take several minutes.
3. Run `npm run smoke:clamav`.
4. Confirm clean payload returns `clean`.
5. Confirm EICAR payload returns `infected`.
6. Restart `backend` and `admin_backend` with `FILE_SCAN_MODE=clamav`.
7. Upload a clean disposable document and confirm the immediate status is `pending_scan`.
8. Refresh after the background worker completes and confirm scan status becomes `clean`.
9. Upload the EICAR test file only in a disposable environment and confirm the immediate status is `pending_scan`, then `infected`.
10. Confirm pending and infected preview/download are blocked when block-until-clean is enabled.
11. Run `npm run documents:expire-pending-scans` after temporarily lowering `FILE_SCAN_PENDING_TIMEOUT_MINUTES` in a disposable environment and confirm stale pending rows become `scan_failed`.
12. Return to `FILE_SCAN_MODE=disabled` only if scanner infrastructure is intentionally unavailable; the UI will then honestly show manual/local/unscanned status.

## Current Local Blocker

On this machine, Docker is not installed and no local `clamscan` binary is available, so the ClamAV daemon cannot be started from the current shell. The app env has been prepared for `127.0.0.1:3310`, but live clean/EICAR upload verification remains blocked until the ClamAV TCP service is running.
