# Testing and CI

[Back to project README](../README.md)

Run npm commands inside the indicated application directory after `npm ci`.

## Local checks

### Backend

Run from `backend/`; unit tests use a fake database pool and need no Docker, database or live server:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
```

### Frontend

Run from `frontend/`:

```bash
npm run lint
npm run check:format
npm run check:import
npm run check:filters
npm run build
```

## Dependency security checks

Run in both `backend/` and `frontend/`:

```bash
npm audit --omit=dev --registry=https://registry.npmjs.org
npm audit --registry=https://registry.npmjs.org
```

The public registry is explicit because some corporate registry proxies reject audit requests.
After dependency changes, run the local checks above and `make rebuild` to renew the containers'
anonymous `node_modules` volumes; installing on the host does not update them.

### Update verification (2026-11-13)

Updated Next.js and its ESLint config to 16.4.6, Sharp to 0.35.5, Zod's minimum to 4.6.6,
and Vitest/coverage to 5.1.0. Compatible transitive security fixes are recorded in both lockfiles.
Both runtime audits (`--omit=dev`) report **zero vulnerabilities**.
Backend type/lint/format checks and 915 tests pass on Node 22.23.5 (15 database tests skipped).
Frontend lint, formatting/import/filter self-checks and the production build also pass on Node 22.
No services were running, so live API/browser checks and container-volume rebuilding remain to be run.

The full audits still report **23 backend findings (8 high, 15 moderate)** and
**7 frontend findings (moderate)** in development tooling:

- Bruno's dependencies include Faker, Axios, form-data, js-yaml, csv-parse, UUID and YAML.
  The current compatible CLI update does not resolve all its pinned dependencies. Do not run
  untrusted collections or scripts; revisit when upstream releases patched dependency versions.
- Drizzle Kit pulls an older esbuild through `@esbuild-kit/esm-loader`. The advisory concerns
  esbuild's development HTTP server, not the application's database queries. Do not expose
  development tooling to untrusted networks; revisit a compatible upstream fix.
- TypeScript ESLint pulls vulnerable minimatch. Lint only trusted source trees; revisit an
  upstream update using patched minimatch.

These are remaining risks, not a clean full-tree security bill. Development dependencies are
also installed in the project's dev containers. No forced downgrades or untested cross-major
overrides were applied merely to suppress advisory counts.

## API smoke tests

Start the stack with `make up`, then follow the [Bruno collection guide](../backend/bruno/README.md) to create its local `.env` with a `TEST_PASSWORD` of at least 12 characters.
Run from `backend/bruno/`:

```bash
npx bru run --env local --cacert ../../nginx/certs/ca/rootCA.pem
```

The guide documents request order, setup and coverage; the local `.env` and `cookies.txt` files are ignored by Git.

For Bruno desktop, select `nginx/certs/ca/rootCA.pem` as the custom CA in Preferences.

## Browser checks

With the frontend and backend running, run from `frontend/`:

```bash
npx playwright install chromium
NODE_EXTRA_CA_CERTS=../nginx/certs/ca/rootCA.pem npm run check:a11y
NODE_EXTRA_CA_CERTS=../nginx/certs/ca/rootCA.pem node status.check.mjs
NODE_EXTRA_CA_CERTS=../nginx/certs/ca/rootCA.pem node friends.check.mjs
```

Browser installation is needed once; see the [accessibility audit](accessibility.md) for criteria and recorded evidence.
The status regression checks failure/recovery, refresh, pause/resume and timeout behavior using simulated backend responses.

## PostgreSQL integration tests

These tests are opt-in and are not enabled in current CI; start PostgreSQL and apply migrations first, then run from `backend/`:

```bash
TEST_DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker npx vitest run tests/db/user-deletion.integration.test.ts tests/db/analytics.integration.test.ts
```

## CI jobs

Throughout development, GitHub Actions ran these code, API and browser checks on relevant pull requests and pushes to `main`; see the [workflow files](../.github/workflows/) for job details.
