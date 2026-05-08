# ClamAV Deployment and Live Scan Checklist

Global LMG document upload scanning uses ClamAV over the TCP `INSTREAM` protocol. The scanner is a real provider; the UI must only show `clean` after ClamAV actually returns `OK`.

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
FILE_SCAN_BLOCK_DOWNLOAD_UNTIL_CLEAN=true
FILE_SCAN_BLOCK_PREVIEW_UNTIL_CLEAN=true
```

Deploy `docker-compose.clamav.yml` beside the backend service or merge its `clamav` service into the hosting compose file. Keep the `clamav-db` volume so virus definitions survive container restarts.

## Live Scan Checklist

1. Start the `clamav` service.
2. Wait for the health check to pass. Initial virus definition download can take several minutes.
3. Run `npm run smoke:clamav`.
4. Confirm clean payload returns `clean`.
5. Confirm EICAR payload returns `infected`.
6. Restart `backend` and `admin_backend` with `FILE_SCAN_MODE=clamav`.
7. Upload a clean disposable document and confirm scan status becomes `clean`.
8. Upload the EICAR test file only in a disposable environment and confirm scan status becomes `infected`.
9. Confirm infected preview/download are blocked.
10. Return to `FILE_SCAN_MODE=disabled` only if scanner infrastructure is intentionally unavailable; the UI will then honestly show manual/local/unscanned status.

## Current Local Blocker

On this machine, Docker is not installed and no local `clamscan` binary is available, so the ClamAV daemon cannot be started from the current shell. The app env has been prepared for `127.0.0.1:3310`, but live clean/EICAR upload verification remains blocked until the ClamAV TCP service is running.
