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

## Evaluator resilience checks

`frontend/resilience.check.mjs` runs adversarial probes, not the normal CI suite.
**Use a separate disposable local instance, never your real expense data.**
The opt-in flag confirms that you have isolated its database, avatar storage, backups and ports;
the script checks loopback URLs but cannot verify that an instance is disposable.
Use local test credentials only, disable outbound integrations and monitor container resources.

Run from `frontend/`, with explicit frontend/API URLs on the same hostname and an absolute evidence path:

```bash
RESILIENCE_DISPOSABLE=1 \
API_URL=https://localhost:8843 \
FRONTEND_URL=https://localhost:3443 \
NODE_EXTRA_CA_CERTS=/absolute/path/to/test-ca.pem \
node --experimental-strip-types resilience.check.mjs boundaries /absolute/path/boundaries.json
```

Ports above are examples for an isolated proxy, not the normal `make up` ports.
HTTPS needs a trusted browser certificate for UI tests and the CA for Node API tests.
The script never disables certificate verification. Explicit loopback HTTP URLs are also supported
for a locally isolated development setup; that does not verify the normal HTTPS browser behavior.

Run one suite at a time:

| Suite | Coverage |
|---|---|
| `boundaries` | Malformed/oversized bodies, text/money/date limits, atomic 1000-row import, reports, pagination, CSV and archived accounts |
| `integrity` | Foreign resource IDs, friendships, session revocation, transfers, pending 2FA, recovery-code replay and paired writes |
| `browser` | Main pages, extreme URL filters, account/transaction double submission and canceling an import preview |
| `pressure` | Incorrect-password rate limit and two-user mixed reads/writes at two requests/second |
| `precision` | Exact balance when individually legal amounts produce a sum outside the safe-integer range |
| `nul-text` | NUL characters in JSON text fields |
| `timestamp` | Parseable timestamps outside the database-compatible range/format |
| `avatar` | MIME/size/ownership checks and rejection of an undecodable signature-only image |
| `delete-race` | Paired category deletion and transaction creation |
| `upload-race` | Concurrent avatar replacement; inspect the disposable avatar volume afterward for unreferenced files |

`integrity` requires a disposable `TOTP_ENCRYPTION_KEY`; otherwise its 2FA check fails explicitly.
Known-defect suites intentionally exit nonzero while the defect exists. A 500 response is not proof
that a process crashed: correlate the JSON evidence with logs, child-process identity, restart/OOM
state and subsequent readiness. Browser failures also save page text and a screenshot beside the JSON.

Each invocation caps direct workload requests at 300, requests in flight at four, request deadlines
at ten seconds, and raw bodies at 6 MiB plus one byte. `pressure` schedules 60 mixed requests over at
least 30 seconds; authentication probes and final assertions are additional, counted requests.
The boundary suite imports 1000 rows. Track the combined request/fixture budget across invocations;
browser assets/server-side fetches, fixture setup, cleanup and health probes are not a complete
traffic count in the direct API counter. This is a bounded evaluator check, not a DoS capacity benchmark.

The script stops a suite on a failed invariant, unexpected response or timeout and attempts fixture
cleanup in `finally`. Review the evidence and verify recovery before another suite. Cleanup failures
report fixture IDs; do not silently ignore them. API deletion cannot prove there are no orphaned files,
so also inspect isolated database/storage state and remove only the explicitly owned test resources.
It does not interrupt services, restore backups, contact Google, or apply application fixes.

## PostgreSQL integration tests

These tests are opt-in and are not enabled in current CI; start PostgreSQL and apply migrations first, then run from `backend/`:

```bash
TEST_DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker npx vitest run tests/db/user-deletion.integration.test.ts tests/db/analytics.integration.test.ts
```

## CI jobs

Throughout development, GitHub Actions ran these code, API and browser checks on relevant pull requests and pushes to `main`; see the [workflow files](../.github/workflows/) for job details.
