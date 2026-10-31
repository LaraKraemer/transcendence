# Transcendence

Final group project as part of the 42 curriculum, building a full-stack expense tracker application.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
	- [Docker](#docker)
	- [Node.js](#nodejs)
- [Clone the Repository](#clone-the-repository)
- [Node Version Setup](#node-version-setup)
- [Project Structure](#project-structure)
- [Environment Setup](#environment-setup)
- [Start the Application](#start-the-application)
- [Database](#database)
- [Authentication API](#authentication-api)
- [Expense Tracker API](#expense-tracker-api)
- [Local API Testing](#local-api-testing)
- [Unit Tests](#unit-tests)
- [Docker Commands](#docker-commands)
- [Development Workflow](#development-workflow)
- [Running Without Docker](#running-without-docker)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [Troubleshooting](#troubleshooting)
- [Git Workflow](#git-workflow)
- [Current Project Status](#current-project-status)
- [Team Notes](#team-notes)

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | TypeScript, Next.js |
| Backend | TypeScript, Node.js, Express |
| Database | PostgreSQL, Drizzle ORM |
| Development Tools | Docker, Docker Compose, Makefile, GitHub Repository, GitHub Projects

<br>

# Prerequisites

Before starting, make sure you have the following tools installed.

### Docker

Check installation:
```bash
docker --version
docker compose version
```

Install:
https://www.docker.com/products/docker-desktop/


### Node.js

Required version:
```
Node.js 22 LTS
```

Check your version:
```bash
node --version
npm --version
```


<br>

# Clone the Repository

```bash
git clone https://github.com/LaraKraemer/transcendence.git

cd transcendence
```

<br>

# Node Version Setup

This project uses Node.js 22.
Install and use the correct version with `nvm`.

https://github.com/nvm-sh/nvm

Then:
```bash
nvm install
nvm use
```

The repository contains an `.nvmrc` file specifying the required Node version.


<br>

# Project Structure

```
transcendence/

├── frontend/              # Next.js frontend application
│
├── backend/               # TypeScript backend service
│
├── docker-compose.yml     # Container orchestration
├── Makefile               # Development commands
└── README.md
```

<br>

# Environment Setup

Docker Compose provides the database configuration for local development.
When running the backend outside Docker, create `backend/.env` with a local
PostgreSQL connection string:

```env
DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker
```

<br>

# Start the Application

### Build Docker Containers

```bash
make build
```

### Start Development Environment

```bash
make up
```

### Or Two Commands combined in One:
```bash
make rebuild
```

The application will start:

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:3001 |


<br>

# Database

Docker Compose starts PostgreSQL with the following **development-only**
credentials:

| Setting | Value |
|---|---|
| User | `expense` |
| Password | `expense` |
| Database | `expense_tracker` |

The backend applies the committed Drizzle migrations automatically when it
starts. To work with the database manually:

```bash
# Open a PostgreSQL shell
docker compose exec db psql -U expense -d expense_tracker

# Run migrations manually, if needed
docker compose exec backend npm run db:migrate
```

Migrations leave 17 reference currencies.

Migration `0008_remove_user_deleted_at` aborts if soft-deleted users exist. Resolve those users explicitly before retrying to avoid unintentionally restoring access.

Inside `psql`, list tables with `\dt` and inspect transactions with:

```sql
SELECT * FROM "transaction";
```

Run `docker compose exec backend npm run db:generate` only after changing
`backend/srcs/db/schema.ts`; commit the generated files in `backend/drizzle/`.

Database data is stored in the `db-data` Docker volume and survives normal
container restarts. Profile images are stored in the `avatar-data` volume
mounted at `/app/avatars` inside the backend container; override the path with
the `AVATAR_DIR` environment variable. `make clean` removes both volumes. PostgreSQL reads its initial user, password, and
database name only when this volume is first created, so changing those values
later requires recreating the volume.


<br>

# Authentication API

The backend supports email/password registration and session-based login. The
session is stored in an HTTP-only cookie; clients must send requests with
credentials enabled. Sessions expired or revoked more than seven days ago are
deleted at startup and every six hours.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create an account and start a session |
| `POST` | `/auth/login` | Start a session with email and password |
| `PATCH` | `/auth/password` | Change password and revoke every session |
| `POST` | `/auth/logout` | Revoke the current session |
| `GET` | `/auth/me` | Return the current authenticated user |
| `PATCH` | `/auth/me` | Update the current user's display name |
| `PUT` | `/auth/me/avatar` | Upload or replace the profile image (raw JPEG/PNG body, max 5 MiB) |
| `GET` | `/auth/me/avatar` | Retrieve the profile image |
| `DELETE` | `/auth/me/avatar` | Remove the profile image |

`PUT /auth/me/avatar` takes the image as the raw request body with
`Content-Type: image/jpeg` or `image/png` (not multipart). Anything else is
rejected with 415 and bodies over 5 MiB with 413. The upload is also validated
by reading the file's format signature (the first bytes every JPEG/PNG file
must start with), so a renamed non-image with the right header is still
rejected. `GET /auth/me`, login and register return `avatarUrl` as
`/auth/me/avatar?v=<version>` when an image exists, otherwise `null`; the
version changes with every upload, so browsers fetch a replaced image.

```bash
curl -i -b cookies.txt -X PUT \
  -H 'Content-Type: image/png' \
  --data-binary @avatar.png \
  http://localhost:3001/auth/me/avatar
```

Example registration request:

```bash
curl -i -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-secure-password","displayName":"Your name"}' \
  http://localhost:3001/auth/register
```

Passwords must have at least 12 characters (`.length >= 12`) and at most 72 UTF-8
bytes. Password hashes, not passwords, are stored in the database. Google and other provider logins will be added later through
a separate account-identity table.

`PATCH /auth/password` requires authentication and a JSON body:
`{"currentPassword":"a-secure-password","newPassword":"another-secure-password"}`.
The new password follows the registration policy. Success returns `204`, atomically
updates the password hash, `password_changed_at`, and `updated_at`, revokes every
session (including other devices), and clears the session cookie. Log in again
with the new password. Missing/non-string fields or invalid new passwords return
`400`; unauthenticated requests return `401`; incorrect current passwords return
`401` with `{"error":"Invalid current password"}`. Rejected requests leave the
password and sessions unchanged.

Registration and login share a per-IP limit of 100 requests per 15 minutes.
Login also allows 10 attempts per client IP and normalized email per 15
minutes. Override the maximum request counts with `AUTH_RATE_LIMIT_MAX` and
`LOGIN_RATE_LIMIT_MAX`. The default limiter stores counts in memory, so they
reset when the backend restarts and are not shared across backend instances.

By default, forwarded client-IP headers are ignored. If the backend is behind
a trusted reverse proxy, set `TRUST_PROXY` to the number of trusted proxy hops
(for example, `1` for one proxy); leave it unset when connecting directly.
Only enable this when every request reaches the backend through the configured
proxy chain. The proxy must overwrite or sanitize client-supplied forwarding
headers, and clients must not be able to connect directly to the backend.


<br>

# Expense Tracker API

Account, category, and transaction routes require an active session cookie.
Each route is scoped to the authenticated user, so one user cannot read or
modify another user's financial data.

| Resource | Endpoints |
|---|---|
| Accounts | `GET`, `POST` `/accounts`; `GET`, `PATCH`, `DELETE` `/accounts/:accountId` |
| Categories | `GET`, `POST` `/categories`; `GET`, `PATCH`, `DELETE` `/categories/:categoryId` |
| Transactions | `GET`, `POST` `/transactions`; `POST` `/transactions/transfers`; `GET` `/transactions/summary`; `GET` `/transactions/export`; `GET` `/transactions/count/:categoryId`; `GET`, `PATCH`, `DELETE` `/transactions/:transactionId` |
| Currencies | `GET` `/currencies` |
| Analytics | `GET` `/analytics/timeseries`; `GET` `/analytics/categories` |

`DELETE /auth/me` requires an active session and permanently deletes the authenticated user, all their accounts (including archived accounts), categories, transactions, and sessions. Transactions cascade when their account or creator is deleted,
following the account hard-delete policy from #48. Deletion is atomic, returns `204`, and clears the session cookie; all previous sessions then return `401`. The request cannot select another user. Deleted email addresses can be registered again.

`GET /currencies` requires an active session and returns global reference data
ordered by code. Each object contains `code`, `name`, `symbol`, and numeric
`minorUnit` (`2` for all catalogue currencies). Convert integer minor units with
`amountMinor / 10 ** minorUnit` and use locale-aware formatting for display.
The catalog is not an exhaustive ISO 4217
validator; accounts still accept any three-uppercase-letter currency code.

`PATCH /accounts/:accountId` rejects a different `currencyCode` with `409` while
transactions currently exist in the account. Submitting the current currency used is allowed. Accounts without transactions may change currency, even with an opening
balance; this does not convert the opening balance, so we need to review and adjust it as needed.

Archived accounts remain readable. Existing transactions can be edited and deleted without restoring the account.
`{"error":"Account is archived. Restore it before making changes."}`.
Restore with `PATCH /accounts/:accountId` using only `{"isArchived": false}`, then edit
separately. Repeated archiving returns `200`; missing or foreign resources return `404`.
Permanent account deletion is handled separately in #48.

`GET /transactions` lists one account with `?accountId=`, or without it the transactions of all
your accounts, archived ones included. `GET /accounts` lists active accounts; `GET /accounts?archived=true`
lists only archived ones. Category and
transaction deletion is permanent; deleting a category sets `categoryId = null` on its linked
transactions. `GET /transactions/count/:categoryId` returns how many transactions use a category.

Every transaction has a `type` (`expense`, `income` or `transfer`) and its signed `amountMinor` must
match it. A category has `types` (one or both of `expense` and `income`) and can be edited at any
time; changing or deleting it never changes existing transactions. Transfers between two of your
accounts are created with `POST /transactions/transfers`: two linked transactions without a
category, deleted together.

`DELETE /accounts/:accountId` permanently removes the owned account and all its transactions.
`DELETE /transactions/:transactionId` permanently removes one transaction.

Transactions accept an optional `merchant` (max 100 trimmed characters); `null` or blank clears it.

## Analytics and CSV export

These authenticated routes include archived accounts and **exclude transfers**.
Both `from` and `to` are required calendar dates (`YYYY-MM-DD`), inclusive, with
`from <= to` and at most 1827 days between them (about five years). Invalid or
repeated filter values return `400`; missing or foreign accounts/categories return
`404`. Optional `type` is `expense` or `income`. Optional `accountId` restricts the
result to one owned account; otherwise all owned accounts are included.

| Endpoint | Additional query parameters | Response |
|---|---|---|
| `/analytics/timeseries` | Required `granularity=day\|week\|month`; optional `categoryId` | Array of `{ period, currencyCode, incomeMinor, expenseMinor }` |
| `/analytics/categories` | Optional `categoryId` | Array of `{ categoryId, type, totalMinor, count, currencyCode }` |
| `/transactions/export` | Required `format=csv`; optional `categoryId` | UTF-8 CSV attachment, `transactions.csv` |

JSON amounts are integer minor units with their original signs: income positive,
expense negative. Totals always remain separate per currency; there is no
converted grand total. Category IDs can be `null` for uncategorized transactions.
The existing `/transactions/summary?accountId=` response is unchanged.

Time-series `period` is the bucket's start date: the date itself, Monday for
weeks, or the first day for months. A first bucket may start before `from`, but
its totals still include only transactions inside the requested dates. Rows are
ordered by period then currency.

```text
GET /analytics/timeseries?from=2025-01-01&to=2025-01-03&granularity=day
GET /analytics/categories?from=2025-01-01&to=2025-01-31&type=expense
GET /transactions/export?format=csv&from=2025-01-01&to=2025-01-31
```

CSV columns are `account,currency,date,type,category,merchant,description,amount`,
ordered by booked date, creation time, then transaction ID. Amounts use a decimal
point and the reference currency's `minorUnit` (fallback `2` for currencies outside
the catalog, matching the UI).

<br>

# Local API Testing

The repository includes a Bruno collection for repeatable local API testing in
`backend/bruno/`. It registers a disposable user, creates two accounts, a category,
and a transaction, then updates and deletes that transaction, makes and deletes a transfer, and permanently deletes the account.
It also checks the currency catalog populated by migrations.
The final analytics requests verify two-currency totals, archived data,
zero-filled periods, transfer exclusion, and spreadsheet-safe CSV.

1. Start the services:

   ```bash
   make rebuild
   ```

2. Create your untracked Bruno environment file:

   ```bash
   cp backend/bruno/.env.example backend/bruno/.env
   ```

3. Set `TEST_PASSWORD` in `backend/bruno/.env` to a password of at least 12
   characters.

4. Open the `backend/bruno/` folder as a collection in the Bruno desktop app,
   choose the `local` environment, and run requests in numerical order.

	OR run bruno test from CLI

	```bash
   cd backend/bruno
	npx bru run --env local
   ```

See [the Bruno collection guide](backend/bruno/README.md) for details. The
local `.env` file and any `cookies.txt` files are ignored by Git.


<br>

# Code Checks

Run backend checks from `backend/`:

```bash
npm ci
npm run typecheck          # source, tests, Vitest and Drizzle configuration
npm run lint               # ESLint recommended JavaScript/TypeScript rules
npm run format:check       # verify Prettier formatting
npm run format             # apply formatting
```

Prettier uses the root `.prettierrc.json` (print width 100). Generated migrations,
Bruno files, coverage output and the package lockfile are excluded from formatting.
To ignore the dedicated formatting commit in local blame output, run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` from the repository root.

Backend CI runs these checks and unit tests, plus the complete Bruno collection against a fresh PostgreSQL 17 database.
with `TEST_DATABASE_URL` set using
`npx vitest run tests/db/user-deletion.integration.test.ts` from `backend/`.
API startup applies migrations; CI waits for `/health`, then runs requests and
prints the API log if a step fails.

From `frontend/`, run `npm ci`, `npm run lint`, `npm run check:format`, `npm run check:import` and `npm run build`.
With the stack running (`make up`), `npm run check:a11y` scans every page with axe (run `npx playwright install chromium` once first); see `docs/accessibility.md`.
Frontend CI runs lint, the `formatAmount` self-check and build, and the accessibility scan against a production build. Both workflows run on relevant pull requests and pushes to
`main`, with read-only repository permissions and cancellation of superseded runs.

<br>

# Unit Tests

Backend unit tests run without Docker, a database, or a live server. They use
a fake pool to intercept Drizzle queries, so every route handler, auth helper,
and validation function is covered in isolation.

```bash
cd backend
npm test                   # single run, exits with pass/fail
npm run test:watch         # watch mode — re-runs affected files on save
npm run test:coverage      # single run with V8 coverage report (writes backend/coverage/)
```

Test files live in `backend/tests/`, mirroring `backend/srcs/`:

| Test file | Covers |
|---|---|
| `tests/auth.test.ts` | session lifecycle, hashing, middleware |
| `tests/routes/auth.test.ts` | register, login, logout, me |
| `tests/routes/protection.test.ts` | protected routes reject unauthenticated requests |
| `tests/routes/account.test.ts` | account CRUD + balance |
| `tests/routes/category.test.ts` | category CRUD |
| `tests/routes/currency.test.ts` | currency metadata, ordering, empty results, errors |
| `tests/routes/transaction.test.ts` | transaction CRUD, type/sign and category rules, transfers |
| `tests/routes/analytics.test.ts` | bounded filters, ownership, time series, category totals, safe CSV |
| `tests/db/analytics.integration.test.ts` | PostgreSQL aggregation, zero filling, currency separation, export filters (opt-in) |
| `tests/validation.test.ts` | isUuid, isCurrencyCode, isIsoTimestamp, isDateOnly, isHexColor |
| `tests/db/accounts.test.ts` | findOwnedAccount ownership filter |
| `tests/db/client.test.ts` | DATABASE_URL guard, pool error handler |
| `tests/app.test.ts` | HTTP wiring: health, CORS, router mount, error handler |

<br>

# Docker Commands
### Docker Commands

| Command | Description |
|---|---|
| `make up` | Start containers |
| `make down` | Stop containers |
| `make build` | Rebuild containers |
| `make rebuild` | Rebuild and renew dependency volumes after Dockerfile or dependency changes |
| `make restart` | Restart containers |
| `make logs` | View container logs |
| `make clean` | Remove containers and volumes |
| `make prune` | Remove unused images to free storage |
<br>

# Development Workflow

Both app containers install locked dependencies with `npm ci` and run as the
unprivileged `node` user. `make rebuild` renews anonymous dependency volumes,
while preserving the named database volume. On Linux, bind-mounted directories
must be writable by the container user (UID 1000), including `backend/drizzle/`
for migration generation and `frontend/` for `.next` output.

The Docker setup uses volume mounting.

This means source code changes are automatically reflected without rebuilding containers.

### Frontend Changes

Edit:

```
frontend/app/
```

Next.js automatically reloads changes.


### Backend Changes

Edit:

```
backend/srcs/
```

The backend automatically restarts.

<br>

# Running Without Docker

Docker is the recommended development method.
However, both applications can run independently.


### Backend

| Step | Command / Information |
|---|---|
| Navigate | `cd backend` |
| Install dependencies | `npm install` |
| Start development server | `npm run dev` |
| Backend URL | `http://localhost:3001` |


### Frontend

| Step | Command / Information |
|---|---|
| Navigate | `cd frontend` |
| Install dependencies | `npm install` |
| Start development server | `npm run dev` |
| Frontend URL | `http://localhost:3000` |


<br>

# Troubleshooting

### Port Already In Use

Check running containers:

```bash
docker ps
```

Stop containers:

```bash
make down
```

### Dependency Changes

If `package.json` changes:

Rebuild containers:

```bash
make rebuild
```

Uninstall dependencies:
```bash
cd backend
rm -rf node_modules package-lock.json
npm install
```

---

### Complete Docker Reset

If Docker behaves unexpectedly:

```bash
make clean
make rebuild
```

---

# Git Workflow

Update your branch:

```bash
git fetch origin
git pull
```

Create a feature branch:

```bash
git checkout -b feature/<feature-name>
```

Commit changes:

```bash
git add -p

git commit -m "Describe your change"
```

Push:

```bash
git push origin feature/<feature-name>
```

Create Pull Request on GitHub.

---

# Current Project Status

### Completed

- [x] Simple Next.js frontend setup
- [x] Simple TypeScript backend setup
- [x] Docker development environment
- [x] Makefile development commands

### Planned (List is work in progress)

- [ ] PostgreSQL integration
- [ ] Database schema
- [ ] Authentication
- [ ] Expense management
- [ ] File upload management
- [ ] Advanced search and filtering
- [ ] Custom design system
- [ ] Prometheus monitoring
- [ ] Grafana dashboards

---

# Team Notes

The goal of this setup is to provide a simple and consistent development environment.

New team members should be able to:

1. Clone the repository
2. Run `nvm use`
3. Run `make build`
4. Run `make up`
5. Start developing


## Avatar upload preview

Avatar selection now opens a local preview: **Upload** saves it, **Replace selection**
chooses another file and **Cancel** leaves the current avatar untouched. Saving uses
an indeterminate progress indicator; JPEG/PNG and the 5 MiB limit are unchanged.

## JSON transaction import

Use **Import JSON** on the transactions page, select an active destination account,
choose a file, review the preview and confirm **Import all**. Rows are imported as expense/income transactions. Each row may include an optional
`category` name matching an existing category belonging to you and allowing its transaction
type. Names are trimmed and matched exactly (case-sensitive); missing, null or blank names
leave the transaction uncategorized. Unknown or incompatible categories reject the whole import. Canceling the preview writes nothing.
The file is not retained. Importing it again creates duplicates; check the list before
retrying after a network failure, since the previous import may have completed.

`POST /transactions/import?accountId=<uuid>` requires authentication and accepts a raw
`application/json` document, up to **5 MiB** and **1–1,000 transactions**:

```json
{
  "version": 1,
  "currency": "EUR",
  "transactions": [
    {
      "bookedOn": "2026-10-20",
      "type": "expense",
      "amountMinor": -2499,
      "description": "Weekly groceries"
    }
  ]
}
```

`bookedOn`, `type` and `amountMinor` are required. `description`, `notes`, `category` and
`occurredAt` are optional and use the same limits/defaults as manual creation.
Money is a signed non-zero safe integer in minor units; currency must match the
account. Unsupported fields/versions, transfers, invalid rows and missing/foreign
or archived destinations are rejected. Row errors identify the first invalid row.
The server locks the destination account and inserts the whole batch atomically.
Success returns `201 { "imported": <count> }`. Validation failures return 400,
missing/foreign accounts 404, archived accounts 409 and oversized bodies 413.

Frontend import preview regression check: `cd frontend && npm run check:import`.
