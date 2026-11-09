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

Use `npm run format` to apply formatting, `npm run test:watch` for watch mode or `npm run test:coverage` for V8 reports in `backend/coverage/`.
Tests mirror `backend/srcs/` under `backend/tests/`; their presence does not imply exhaustive coverage.
Prettier uses root `.prettierrc.json` (print width 100), excluding migrations, Bruno files, coverage and lockfiles.
To ignore the dedicated formatting commit in blame, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` at the repository root.

### Frontend

Run from `frontend/`:

```bash
npm run lint
npm run check:format
npm run check:import
npm run check:filters
npm run build
```

## API smoke tests

Start the stack with `make up`, then follow the [Bruno collection guide](../backend/bruno/README.md) to create its local `.env` with a `TEST_PASSWORD` of at least 12 characters.
Run from `backend/bruno/`:

```bash
npx bru run --env local
```

The guide documents request order, setup and coverage; the local `.env` and `cookies.txt` files are ignored by Git.

## Browser checks

With the frontend and backend running, run from `frontend/`:

```bash
npx playwright install chromium
npm run check:a11y
node status.check.mjs
```

Browser installation is needed once; see the [accessibility audit](accessibility.md) for criteria and recorded evidence.
The status regression checks failure/recovery, refresh, pause/resume and timeout behavior using simulated backend responses.

## PostgreSQL integration tests

These tests are opt-in and are not enabled in current CI; start PostgreSQL and apply migrations first, then run from `backend/`:

```bash
TEST_DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker npx vitest run tests/db/user-deletion.integration.test.ts tests/db/analytics.integration.test.ts
```

## CI jobs

Throughout development, we used GitHub Actions CI pipelines to run the checks below on relevant pull requests and pushes to `main`.

| Job | Checks / services |
|---|---|
| Backend checks | Typecheck, lint, formatting and unit tests. |
| Backend API | Bruno against fresh PostgreSQL 17; API startup applies migrations, waits for `/health` and prints logs on failure. |
| Frontend checks | Lint, money-formatting/import-preview/URL-filter self-checks and build. |
| Browser checks | Status regression and accessibility scan against a production frontend with backend/PostgreSQL. |

Workflows run on relevant pull requests and pushes to `main`, with read-only repository permissions and cancellation of superseded runs.
