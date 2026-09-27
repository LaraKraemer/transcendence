# Copilot instructions

Full-stack personal expense tracker (42 Berlin "transcendence" group project). Two independent npm projects with their own lockfiles — `backend/` (Express 5 + Drizzle ORM + PostgreSQL 17, TypeScript ESM) and `frontend/` (Next.js 16 + React 19 + Tailwind CSS 4) — run together with Docker Compose. There is no npm workspace: run npm commands inside `backend/` or `frontend/`. Node 22 (`.nvmrc`, also used by CI and the Dockerfiles).

## Commands

Stack (the Makefile wraps `docker compose`):

```bash
make up          # start db, backend (:3001), frontend (:3000)
make rebuild     # build + start; needed after Dockerfile or package.json changes
make down        # stop
make logs        # follow all logs
make clean       # WARNING: also deletes the db-data volume (all local DB data)
curl localhost:3001/health   # {"status":"ok","db":"ok"}; 503 when the DB is unreachable
```

Source dirs are bind-mounted, so `tsx watch` and `next dev` hot-reload inside the containers. Container `node_modules` are anonymous volumes, separate from the host's: `npm install` on the host doesn't change the containers, and `make rebuild` reuses the old volumes — if a newly added dependency is missing in a container, run `docker compose up -d --build --renew-anon-volumes`.

Backend (from `backend/`):

```bash
npm test                                   # all Vitest unit tests; no DB or server needed (what CI runs)
npm test -- tests/routes/account.test.ts   # one file
npm test -- -t "isCurrencyCode"            # tests whose name matches
npm run test:watch
npx tsc --noEmit                           # type-check; covers srcs/ only (tests/ is outside tsconfig "include")
```

Running the backend on the host needs `DATABASE_URL` in `backend/.env`. Start only Postgres with `docker compose up -d db` and use `DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker` (dev-only credentials from `docker-compose.yml`), then `npm run dev` (`tsx watch srcs/index.ts` on :3001) or `npm run db:studio`.

Database:

```bash
docker compose exec backend npm run db:generate   # after editing srcs/db/schema.ts; commit drizzle/*.sql and drizzle/meta/*
docker compose exec backend npm run db:migrate    # manual apply (the server also migrates on startup)
docker compose exec db psql -U expense -d expense_tracker
```

`npm run db:seed` is intentionally a no-op because all data is user-owned; use the Bruno collection to create data.

API smoke test: `backend/bruno/` is a Bruno collection that registers a disposable user, creates an account, category, and transaction, then updates and voids the transaction. Copy `backend/bruno/.env.example` to `backend/bruno/.env` and set `TEST_PASSWORD` (≥ 12 chars). With the stack running, open the folder in the Bruno app (`local` environment) or run it headless with the bundled CLI:

```bash
cd backend/bruno && npx bru run --env local
```

Frontend (from `frontend/`): `npm run dev`, `npm run build`, `npm run lint` (ESLint 9 flat config from `eslint-config-next`).

## Architecture

Browser → Next.js (`:3000`) → Express API (`:3001`) → PostgreSQL (`:5432`, published on 127.0.0.1 only).

- **Auth** (`srcs/auth.ts`, `srcs/routes/auth.ts`): email/password with server-side sessions. The raw token lives only in the HTTP-only `session` cookie (30 days); the `session` table stores its SHA-256 hash. Passwords use bcrypt (cost 12) and must be at least 12 characters and at most 72 bytes (bcrypt's input limit). Emails are trimmed and lowercased.
- **Frontend → API**: the base URL is `NEXT_PUBLIC_API_URL` (`http://localhost:3001` in Compose). The API's CORS allows `FRONTEND_ORIGIN` (default `http://localhost:3000`) with credentials, so browser requests must use `credentials: "include"` to send the session cookie.
- **Protected routers** (`srcs/routes/{account,category,transaction}.ts`) start with `router.use(requireAuthenticatedUser)`, which puts the caller's ID in `res.locals.userId`. All routers are mounted in `srcs/index.ts`.
- **Startup**: `srcs/index.ts` awaits `runMigrations()` (applies `backend/drizzle/`) before `app.listen`, so schema changes reach the DB only through a committed generated migration.
- **DB client**: `srcs/db/client.ts` exports the shared Drizzle `db` and `pg` `pool`, and throws at import time if `DATABASE_URL` is unset. That's why entry points (`srcs/index.ts`, `srcs/db/migrate.ts`, `srcs/db/seed.ts`) import `"dotenv/config"` first, and why unit tests must mock `db/client.ts`.
- **Schema source of truth** is `srcs/db/schema.ts`. `docs/mvp-db-schema.md` and `docs/full-db-schema.md` are target ER designs (Mermaid) that include tables not implemented yet.

API surface:

| Mount | Routes |
|---|---|
| `/auth` | `POST /register`, `POST /login`, `POST /logout`, `GET /me` |
| `/accounts` | `GET /`, `POST /`, `GET /:accountId`, `PATCH /:accountId`, `GET /:accountId/balance` |
| `/categories` | `GET /`, `POST /`, `GET /:categoryId`, `PATCH /:categoryId`, `DELETE /:categoryId` |
| `/transactions` | `GET /?accountId=` (required), `GET /summary?accountId=&from=&to=`, `POST /`, `GET /:transactionId`, `PATCH /:transactionId`, `DELETE /:transactionId` |

## Domain rules (enforced across several routers — keep them consistent)

- Money is integer minor units (`amountMinor`, `openingBalanceMinor`; Postgres `bigint` read as JS numbers), validated with `Number.isSafeInteger`. A transaction's sign is its direction: negative = expense, positive = income; zero is rejected by the app and by a DB CHECK. Postgres aggregates come back as strings, so convert them with `Number(...)` or `` sql<number>`SUM(...)`.mapWith(Number) ``.
- A transaction's category kind must match its sign (`expense` for < 0, `income` for > 0); `transfer` categories accept either sign. Category `kind` is immutable, and `(user, name, kind)` is unique (routes pre-check and return 409).
- Nothing is hard-deleted. Accounts are archived/unarchived with `PATCH /accounts/:accountId` and `{"isArchived": true|false}` (there is no account DELETE); `DELETE /categories/:categoryId` sets `isArchived: true`; `DELETE /transactions/:transactionId` sets `status: "void"`. Void transactions still appear in lists but are excluded from balance and summary.
- Archived accounts are hidden from `GET /accounts` but stay readable by ID, including balance and transaction list/summary; they can't receive new transactions (`findOwnedAccount(id, userId, false)`). Archived categories can't be newly assigned, but an existing assignment survives other transaction edits.
- `bookedOn` is a `YYYY-MM-DD` date string used for filtering and reports; `occurredAt` is an optional ISO 8601 timestamp.
- Enum-like columns (`account.type`, `category.kind`, `transaction.status`) are plain `text` in Postgres. Allowed values live in `as const` arrays with type guards at the top of each router (`ACCOUNT_TYPES`, `CATEGORY_KINDS`, `TRANSACTION_STATUSES`), so adding a value needs no migration.

## Backend conventions

- ESM + NodeNext, executed directly by `tsx` (no build output): relative imports use explicit `.ts` extensions, and `verbatimModuleSyntax` requires `import type` for type-only imports. Imports are grouped `node:` built-ins → packages → local files, separated by blank lines.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. That's why inserts add optional fields with conditional spreads (`...(notes === undefined ? {} : { notes: notes.trim() })`) and why `const [row] = await db…` results are checked before use.
- Handler shape: validate input with early returns (`res.status(400).json({ error: "<field> must …" }); return;`) and wrap DB work in `try { … } catch (error) { next(error); }`. The global handler in `index.ts` turns forwarded errors into `500 {"error":"Internal server error"}`. Error bodies are always `{ error: string }`. Route handlers and helpers get a short `/** … */` doc comment.
- Ownership: scope every query by `res.locals.userId` and answer **404** (never 403) for missing or foreign resources. Validate `:id` params with `isUuid` before querying. Reuse `findOwnedAccount` (`srcs/db/accounts.ts`); transactions are owned through a join on `account.user_id`.
- PATCH: detect fields with `Object.hasOwn(body, field)` so an explicit `null` clears nullable columns; reply 400 when no editable field is given; set `updatedAt: new Date()` explicitly (no DB trigger; `category` has no `updatedAt`).
- Register static sub-routes such as `/summary` before `/:id` routes.
- Reusable pure validators go in `srcs/validation.ts`; resource-specific guards stay in their router file.
- Generated migrations may be hand-edited for data backfills — `drizzle/0005_charming_doorman.sql` adds a nullable column, backfills it, then sets `NOT NULL`.
- No formatter or linter is configured for the backend; follow the existing style (2 spaces, double quotes, semicolons, trailing commas).

## Backend tests

- Vitest (`environment: "node"`), no database. Tests live in `backend/tests/`, mirroring `srcs/` (`tests/routes/account.test.ts` ↔ `srcs/routes/account.ts`), and import code via relative paths such as `../../srcs/routes/account.ts`.
- CI (`.github/workflows/backend-unit-tests.yml`) runs `npm ci && npm test` in `backend/` on pushes and PRs touching `backend/**`.
- Coverage: `npm run test:coverage` (V8). Included: `srcs/**/*.ts` minus `index.ts`, schema, seed, migrate files. Reports to `backend/coverage/`.
- All route and module tests use the **fake-pool pattern**: `vi.hoisted(() => ({ query: vi.fn() }))` produces a shared `query` mock; `vi.mock("../../srcs/db/client.ts", ...)` returns `{ db: drizzle({ query } as Pool), pool }`. Drizzle runs with `rowMode: "array"`, so mocked rows must be positional arrays in schema-column order.
- Use the `dispatch` helper (`tests/helpers/dispatch.ts`) to send a request object through a router and get `{ status, body }` back without opening a port.
- Use the `row` helper (`tests/helpers/rows.ts`) to produce a correct positional array from a Drizzle table schema and a `Record<string, unknown>`.
- Auth tests (`tests/auth.test.ts`) use `vi.useFakeTimers({ toFake: ["Date"] })` to pin timestamps; bcrypt tests need a `15_000` ms timeout. Production-mode tests use `vi.stubEnv("NODE_ENV", "production") + vi.resetModules() + await import(...)` to reload the module with the new env.
- Route auth tests (`tests/routes/auth.test.ts`) mock all `auth.ts` helpers via `vi.hoisted` to keep bcrypt out of the test.
- `tests/app.test.ts` is the only test that opens a real TCP port (using `createApp().listen(0)`). It mocks `db/client.ts` with an EventEmitter-based pool.

## Frontend

- **Next.js 16 has breaking changes versus most training data** (`frontend/AGENTS.md`): read the relevant guide in `frontend/node_modules/next/dist/docs/` before writing Next.js code, and heed deprecation notices. Those docs exist on the host only after `npm install` in `frontend/` (the container's `node_modules` isn't visible on the host).
- `next dev` re-adds the marked block in `frontend/AGENTS.md`; keep it committed as-is (`frontend/CLAUDE.md` just imports it).
- App Router in `frontend/app/`; `@/*` aliases `frontend/*`. Tailwind v4 is wired through `@tailwindcss/postcss`, with theme tokens in `app/globals.css` (`@import "tailwindcss"`, `@theme inline`); there is no `tailwind.config.*`.

## Git workflow

Branch from `main` as `feature/<name>` and open a PR. Commit subjects mostly follow Conventional Commits (`feat(backend): …`, `fix: …`, `refactor: …`), sometimes prefixed with the issue number (`#20 …`).
