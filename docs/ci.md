# Continuous Integration

GitHub Actions runs the repository CI workflow on every push and pull request.

The default CI path is intentionally offline-safe:

- installs dependencies for the root project and all four app packages;
- runs `npm run lint:all`;
- runs `npm run check:all` for typechecks, unit/component tests, safe-mode E2E, and builds;
- runs production dependency audits with `npm audit --omit=dev` for each package root.

Live Playwright flows are not run by default. The workflow sets `E2E_RUN_LIVE=false` and
`E2E_RUN_MUTATIONS=false`, so provider keys, real databases, and live payment credentials are not
required. Add a separate opt-in workflow for staged live E2E if those checks are needed later.

## Local CI Check

Run the same dependency setup and checks locally before opening a release PR:

```bash
npm ci
npm --prefix backend ci
npm --prefix admin_backend ci
npm --prefix frontend ci
npm --prefix admin_frontend ci
npm run lint:all
npm run check:all
npm audit --omit=dev
npm --prefix backend audit --omit=dev
npm --prefix admin_backend audit --omit=dev
npm --prefix frontend audit --omit=dev
npm --prefix admin_frontend audit --omit=dev
```

Do not put provider secrets in CI. If a check starts requiring live services, gate it behind an
explicit environment variable and keep it out of the default push/pull-request workflow.
