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
- [Monitoring](#monitoring)
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

Before starting Compose, copy the root environment template and set the exporter password and Grafana admin credentials:

```bash
cp .env.example .env
```

Compose creates the PostgreSQL monitoring user automatically before starting the exporter.
See [Monitoring setup](docs/monitoring.md#1-initial-setup-once-per-installation).
Docker Compose provides the database configuration for local development.
When running the backend outside Docker, create `backend/.env` with a local
PostgreSQL connection string:

```env
DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker
```

### Google sign-in (optional)

Without these variables, the "Continue with Google" button returns to the login
page with an error. To turn it on:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. Configure the OAuth consent screen: choose **External**, keep it in **Testing**,
   and add the Google accounts that may sign in as test users.
3. Under **Credentials**, create an **OAuth client ID** of type **Web application**
   with the authorized redirect URI `http://localhost:3000/auth/google`
   (it must match exactly; add your deployed origin's `/auth/google` too).
4. Create `.env` in the repository root (ignored by Git). Docker Compose passes it
   to the backend and frontend:

   ```env
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```

5. Run `make up`. Running without Docker, put both variables in `backend/.env`
   and `GOOGLE_CLIENT_ID` in `frontend/.env.local`.

### Two-factor authentication (optional)

Users can turn on time-based one-time passwords (authenticator apps such as Google
Authenticator or 1Password). This needs no Google Cloud setup. The backend only needs a key
to encrypt the stored TOTP secrets:

```bash
openssl rand -base64 32
```

Put the result in the git-ignored root `.env` as `TOTP_ENCRYPTION_KEY=...` (Docker Compose passes it
to the backend), or in `backend/.env` when running without Docker. Without it, `POST /auth/2fa/setup`
returns `404`, and the backend refuses to start if any user already has 2FA on. Keep the key with your
other secrets: if it is lost or changed, stored secrets cannot be decrypted and affected users must
sign in with a recovery code and set 2FA up again.

In the app, open **Profile → Two-factor authentication → Enable**: scan the QR code with an authenticator app
(or type the secret shown under it), enter the 6-digit code, then save the 10 recovery codes (copy or download;
they are shown once). Signing in then asks for a code after the password or Google, with a "Use a recovery
code" link. **Disable** asks for the password (accounts that have one) and a code.

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
| Grafana | http://localhost:3002 (login required) |
| Prometheus | http://localhost:9090 (debug mode only) |

See [Monitoring](docs/monitoring.md#temporary-prometheus-access) to enable debug access.

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
the `AVATAR_DIR` environment variable. `make clean` removes both volumes.
PostgreSQL reads its initial user, password, and database name only when this
volume is first created, so changing those values later requires recreating the volume.

### Backups and recovery

Daily database/avatar backups live in the host `./backups` directory and survive
cleanup. See [disaster recovery](docs/disaster-recovery.md) for retention,
limitations and the restore procedure and its confirmation argument.


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
| `POST` | `/auth/google` | Start a session with a Google authorization code (called by the frontend) |
| `PATCH` | `/auth/password` | Change password and revoke every session |
| `POST` | `/auth/2fa/setup` | Create a TOTP secret; returns `secret` and `otpauthUri` (2FA stays off) |
| `POST` | `/auth/2fa/enable` | `{"code"}`: turn 2FA on; returns 10 recovery codes, shown once |
| `POST` | `/auth/2fa/verify` | `{"code"}`: finish a login that returned `twoFactorRequired` |
| `POST` | `/auth/2fa/recover` | `{"recoveryCode"}`: finish a pending login with a single-use recovery code |
| `POST` | `/auth/2fa/disable` | `{"password","code"}` (or `recoveryCode`): turn 2FA off and revoke other sessions |
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
bytes. Password hashes, not passwords, are stored in the database.

### Google sign-in

The "Continue with Google" button opens the frontend route `/auth/google`, which
sends the browser to Google with a random state and a PKCE challenge. Google
sends the browser back to the same route, which checks the state and calls
`POST /auth/google` with `{"code", "codeVerifier", "redirectUri"}`. The backend
exchanges the code with Google, then:

- rejects the sign-in (`401`) if Google has not verified the account's email;
- signs in the user already linked to this Google account (`200`);
- links the Google account to an existing account with the same email only when
  that account's `email_verified_at` is set (`200`);
- otherwise returns `409` (`An account with this email already exists`), and the
  login page shows a dedicated "email taken" message. This also happens when
  the account is already linked to a different Google account;
- creates a new account (`201`) when no account uses the email. The account has
  no password, and its email counts as verified.

Linking to an unverified account is refused because whoever registered that
email first would keep password access to the Google user's account. Nothing
sets `email_verified_at` for password accounts yet, so until email verification
exists, they always get the `409`. To test linking locally:

```bash
docker compose exec db psql -U expense -d expense_tracker \
  -c "UPDATE app_user SET email_verified_at = now() WHERE email = 'you@gmail.com';"
```

Linked Google accounts are stored in `user_identity` (one per provider per
user). Accounts created with Google cannot log in with a password (`401`) or
change it (`400`). `GET /auth/me` returns `hasPassword: false` for them.

Two-factor authentication applies to every sign-in method. When the user has 2FA on, `POST /auth/login`
and `POST /auth/google` return `{"twoFactorRequired":true}` (no user data) and a pending session cookie
that lasts 10 minutes. Every route except `POST /auth/2fa/verify`, `POST /auth/2fa/recover` and
`POST /auth/logout` answers `401` for a pending session. `verify` accepts the current 30-second code and one
step either side, and each step works once. `disable` needs the password too (Google-only users send just the
code) and always answers a generic `401` for a wrong password or code. `GET /auth/me` returns
`twoFactorEnabled`. The four code endpoints share a limit of 10 attempts per client IP and user per 15
minutes (`TWOFA_RATE_LIMIT_MAX`), answering `429` after that.

`PATCH /auth/password` requires authentication and a JSON body:
`{"currentPassword":"a-secure-password","newPassword":"another-secure-password"}`.
The new password follows the registration policy. Success returns `204`, atomically
updates the password hash, `password_changed_at`, and `updated_at`, revokes every
session (including other devices), and clears the session cookie. Log in again
with the new password. Missing/non-string fields or invalid new passwords return
`400`; unauthenticated requests return `401`; incorrect current passwords return
`401` with `{"error":"Invalid current password"}`. Rejected requests leave the
password and sessions unchanged.

Registration, login and Google sign-in share a per-IP limit of 100 requests per 15 minutes.
Login also allows 10 attempts per client IP and normalized email per 15
minutes. Override the maximum request counts with `AUTH_RATE_LIMIT_MAX`,
`LOGIN_RATE_LIMIT_MAX` and `TWOFA_RATE_LIMIT_MAX`. The default limiter stores counts in memory, so they
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

`GET /transactions` lists one account with `?accountId=`, or without it the transactions of all your accounts, archived ones included. Search with `q` (case-insensitive, max 500 characters), filter with `categoryId` (owned UUID or `none`) and `minAmountMinor`/`maxAmountMinor` (absolute amounts). Sort with `sort=bookedOn|amountMinor|createdAt` and `order=asc|desc` (default: `bookedOn desc`; amount sorting uses signed amounts). `total`, `moneyInMinor` and `moneyOutMinor` (the sums of the positive and negative amounts, regardless of currency) cover all filtered matches, not only the page.
`GET /accounts` lists active accounts; `GET /accounts?archived=true`
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

These authenticated routes include archived accounts. Time series and CSV export also show transfers (see below);
category totals leave them out.
Both `from` and `to` are required calendar dates (`YYYY-MM-DD`), inclusive, with
`from <= to` and at most 1827 days between them (about five years). Invalid or
repeated filter values return `400`; missing or foreign accounts/categories return
`404`. Optional `type` is `expense` or `income`. Optional `accountId` restricts the
result to one owned account; otherwise all owned accounts are included.

| Endpoint | Additional query parameters | Response |
|---|---|---|
| `/analytics/timeseries` | Required `granularity=day\|week\|month`; optional `categoryId` | Array of `{ period, currencyCode, incomeMinor, expenseMinor, transferOutMinor, transferInMinor }` |
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

`transferOutMinor` (negative legs) and `transferInMinor` (positive legs) are
informational: each transfer leg counts in its own account's currency, and they are
never part of income or expense because a transfer between your own accounts does
not change the overall balance. They are `0` when `type` or `categoryId` is given,
since transfer legs match neither. The CSV export lists transfer legs with type
`transfer` and an empty category.

```text
GET /analytics/timeseries?from=2025-01-01&to=2025-01-03&granularity=day
GET /analytics/categories?from=2025-01-01&to=2025-01-31&type=expense
GET /transactions/export?format=csv&from=2025-01-01&to=2025-01-31
```

CSV columns are `account,currency,date,type,category,merchant,description,amount`,
ordered by booked date, creation time, then transaction ID. Amounts use a decimal
point and the reference currency's `minorUnit` (fallback `2` for currencies outside
the catalog, matching the UI).

The frontend's **Analytics** page (`/analytics`; on mobile under **More**) draws
these routes as line, bar and donut charts, one set per currency, each with a
"Show as table" alternative. Its Net is the change of balance: income and expenses
plus transfers in and out (shown apart, and hidden under a type or category filter).
Its filters (period, account, category, type) live in the URL, and it reloads its data every 30 seconds while the tab is visible.
**Export CSV** downloads `/transactions/export` with the same filters. **Print or
save as PDF** opens the browser's print dialog: the PDF is the browser's own
print-to-PDF, with navigation and controls hidden by a print stylesheet.

<br>

# Local API Testing

The repository includes a Bruno collection for repeatable local API testing in
`backend/bruno/`. It registers a disposable user, creates two accounts, a category,
and a transaction, then updates and deletes that transaction, makes and deletes a transfer, and permanently deletes the account.
It also checks the currency catalog populated by migrations.
The final analytics requests verify two-currency totals, archived data,
zero-filled periods, transfer legs, and spreadsheet-safe CSV.

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

From `frontend/`, run `npm ci`, `npm run lint`, `npm run check:format`, `npm run check:import`, `npm run check:filters` and `npm run build`.
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
| `make down` | Stop and remove containers |
| `make stop` | Stop containers without removing them or their volumes |
| `make build` | Rebuild containers |
| `make rebuild` | Rebuild and renew dependency volumes after Dockerfile or dependency changes |
| `make restart` | Restart containers |
| `make logs` | View container logs |
| `make clean` | Remove containers and volumes (preserves host backups) |
| `make backup` | Back up the database and avatars now |
| `make restore BACKUP=backups/<snapshot> CONFIRM=--confirm` | Replace database and avatars from a trusted snapshot |
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

- [x] Next.js frontend and TypeScript (Express) backend
- [x] Docker development environment and Makefile commands
- [x] PostgreSQL integration (Drizzle ORM, automatic migrations)
- [x] Database schema
- [x] Authentication (email/password, sessions, password change, account deletion)
- [x] Expense management (accounts, categories, transactions, multi-currency transfers)
- [x] File upload management (avatars, JSON transaction import)
- [x] Advanced search and filtering
- [x] Custom design system
- [x] Analytics dashboard and CSV export
- [x] Internationalization (EN, DE, FA with RTL, UK)
- [x] Accessibility (WCAG 2.1 AA, automated axe check)
- [x] Security hardening (rate limiting, HTTP-only sessions)
- [x] Status page, healthchecks, automated backups and disaster recovery
- [x] CI pipelines (tests, lint, API smoke test, a11y)
- [x] Google sign-in
- [x] Two-factor authentication
- [x] Prometheus monitoring
- [x] Grafana dashboards

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

Public status page: `/status` is available without signing in, linked in the footer, and refreshes every 30 seconds, with a pause/resume control. It shows dependency health and the latest backup, or an unreachable message when the backend is offline. Run its browser regression check against the running frontend with `cd frontend && node status.check.mjs`.

Public operational status: `GET /status` reports database latency, avatar storage
permission, process uptime, version and the latest successful backup. `/health`
remains the database readiness endpoint used by CI.

## Design system

`/design-system` (linked in the footer, public) shows the colour palette with light/dark
values and contrast ratios, the type scale, the icons and every component below in the
current theme and language. Reuse these instead of copying class strings:

- Colours are tokens in `frontend/app/globals.css` (`bg-card`, `text-muted-foreground`, …).
- Type roles set size, weight and tracking together: `text-title` (page `<h1>`),
  `text-heading` (dialog title), `text-subheading` (card heading), `text-body`,
  `text-label` (form label), `text-caption` (hint, error), `text-overline` (with `uppercase`).
- `focus-ring` is the keyboard focus ring of links and buttons; add
  `focus-visible:ring-offset-*` where the ring needs a gap.
- Icons are `lucide-react`, `aria-hidden` next to visible text; add `rtl:-scale-x-100` to
  arrows. Category icons come from `CATEGORY_ICONS` in `components/categories/category-icon.tsx`.

| Component (`components/ui/`) | Props | When to use |
|---|---|---|
| `Button`, `buttonClassName` | `variant`: `primary` \| `success` \| `outline` \| `danger`, plus `<button>` props | Full-width form and dialog actions. Show loading as `disabled` with a "…ing" label. `buttonClassName(variant)` styles a `<Link>` as a button. |
| `IconButton` | `label`, `children` (the icon, `aria-hidden`), `variant?` (default `muted`), `size?`: `inline` \| `sm` (default) \| `md` \| `lg` \| `xl` \| `fab`, plus `<button>` props | Every button that shows only an icon: add, edit, archive, delete, close, import, log out. `label` is its accessible name and tooltip. Variants: `primary`, `success`, `danger` (filled); `muted`, `muted-danger`, `muted-warning` (row actions); `card`, `card-danger` (on a muted tile); `ghost`, `plain`, `outline`, `outline-danger`. |
| `ToggleButton` | `label`, `pressed`, `onPressedChange`, plus `IconButton` props | An icon button that is on or off, e.g. show password. The label stays the same; `aria-pressed` tells the state. |
| `TextField` | `id`, `label`, `error?`, `trailing?`, `children?`, plus `<input>` props | Every text, email, password, number or date input. `error` marks it invalid and links the message. |
| `SelectField` | `id`, `label`, `error?`, `hint?`, `children` (`<option>`s), plus `<select>` props | A choice from a list. Required unless `required={false}`. |
| `ChoiceGroup`, `choiceSegmentsClassName`, `choiceSegmentClassName` | `legend`, `idPrefix`, `error?`, `children` | A labelled group of radios or checkboxes with one error. The two class names give the choices the segmented look (`peer sr-only` input, then a styled `<span>`). |
| `Modal` | `open`, `title`, `onClose`, `busy?`, `describedBy?`, `closeOnBackdropClick?` | Forms in a dialog. Mark the first field `data-autofocus`. `busy` blocks closing while saving. |
| `ConfirmDialog` | `open`, `title`, `children`, `confirmLabel`, `onConfirm`, `onCancel`, `pending?`, `confirmDisabled?`, `error?` | Before a destructive action. Focus starts on Cancel. |
| `LiveStatusProvider`, `useAnnounce` | `announce(message)` | Tell screen readers the result of an action whose row disappears ("“Savings” archived"). |
| `FormAlert` | `message` (`null` hides it), `tone?`: `danger` \| `success` | A form-level error at the top of a form, e.g. a network failure, or with `tone="success"` a result such as "Password changed". |
| `Card` | `as?`: `div` \| `section` \| `article` \| `details`, `className` (padding), plus HTML props | Every bordered panel. Use `as="section"` with `aria-labelledby` when it has a heading. |
| `Badge`, `badgeToneClassName` | `tone?`: `neutral` \| `info` \| `success` \| `warning` \| `danger`, `variant?`: `label` \| `pill` | `label`: short uppercase status next to a name. `pill`: a value with an icon. The text must make sense without the colour. |
| `EmptyState` | `href?`, `className` (spacing), `children` | The message where a list has nothing to show. `href` makes it a link to where the user can add something. |
| `StrengthMeter` | `score`, `segments?` (3), `label`, `tone`: `danger` \| `success` | A segmented level with a text label, e.g. password strength (`PasswordStrength` in `components/auth`). |
| `UserAvatar` | `displayName`, `avatarUrl`, `alt` (`""` = decorative), `className` (size and colours) | A user's photo, with initials when there is none or it fails to load. |
| `ThemeToggle` | `variant?`: `auth` (42 px) \| `app` (40 px) | Light/dark switch in page headers. An `IconButton` whose label names the theme it switches to. |
| `LocaleSwitcher` | `variant?`: `select` \| `pill` \| `list` | Language picker: `select` on public pages, `pill` in the app header, `list` on the mobile More page. |

## Monitoring

For local setup and tests, see the [Monitoring guide](docs/monitoring.md).
“Internal” means a service is available inside Docker, without a port open on your computer.

### Services and access

| Service | What it does | Access |
|---|---|---|
| Prometheus | Collects measurements and checks the alert rules in `monitoring/alerts.yml` | Internal; use the debug Compose file for temporary browser access |
| Grafana | Shows the Backend and Database dashboards | http://localhost:3002; log in with the admin details from the root `.env` |
| PostgreSQL exporter | Provides database connection counts, transactions per second and database size | Internal: `postgres-exporter:9187` |
| cAdvisor | Measures container CPU and memory use | Internal: `cadvisor:8080` |
| Alertmanager | Groups alerts and sends Telegram messages when enabled | Internal: `alertmanager:9093` |
| Backend metrics | Provides Node.js, request, business and database connection measurements | Internal: `backend:9100/metrics` |

### Settings and security

| Setting | Details |
|---|---|
| Automatic Grafana setup | Loads the data source and dashboards from files in `monitoring/grafana/` |
| Grafana login | Available only on your computer; login required; users cannot sign themselves up |
| Alert page | http://localhost:3002/alerting/list; shows the rules checked by Prometheus |
| Notifications | Alerts appear in the browser by default; Telegram can also send FIRING and RESOLVED messages |
| Enable Telegram | Add local `.secrets/` files and use `docker-compose.telegram.yml`; see the guide |
| Backend package | `prom-client` in `backend/package.json`; run `make rebuild` after changing dependencies |
| Backend setup | No extra backend environment variables or database table changes needed |
| Metrics access | Keep port 9100 inside Docker; it has no login protection |
| Running without Docker | Port 9100 listens on all host network interfaces (`0.0.0.0`); use Docker to keep it internal |

### Backend measurements

| Metric | Labels | What it measures |
|---|---|---|
| `http_request_duration_seconds` | `method`, `route`, `status_code` | Request times in seconds, grouped into time buckets; `_count` counts requests |
| `users_registered_total` | — | New users saved successfully |
| `logins_total` | `result`: `success` or `failure` | Successful logins or rejected login details |
| `transactions_created_total` | — | Saved transaction rows: 1 for a normal transaction, 2 for a transfer, one per imported row |
| `pg_pool_connections` | `state`: `total` or `idle` | Total database connections and connections that are free to use |
| `pg_pool_waiting_count` | — | Requests waiting for a free database connection |
| `process_*`, `nodejs_*` | Depends on the metric | Standard Node.js measurements, such as CPU and memory use |

### How counting works

| Item | Behavior |
|---|---|
| Counters | Start again when the backend restarts; deleting data does not reduce them |
| Registration | Counts once the user is saved, even if creating the login session then fails |
| Failed database changes | Changes that fail or are undone do not count |
| Failed logins | Counts invalid login details; request metrics record rate limits and server errors |
| Database connection values | Updated when Prometheus collects them; do not include the separate status-check connections |
| Request measurements | Include completed public responses, `/health` and `/status`; do not include requests to the internal metrics server |
| Route names | Use patterns such as `/transactions/:transactionId`, never actual IDs or URL query values |
| Requests without a matched route | Use `unmatched`; this can include requests rejected before a route is selected because the user is not logged in |

### Example queries from our panels

PromQL means Prometheus Query Language. These queries read and calculate measurements.
The panel files also filter backend requests with `job="backend"`.

| Example | Query |
|---|---|
| Requests per second by route | `sum by (route) (rate(http_request_duration_seconds_count[5m]))` |
| p95 response time by route (95% of requests are at or below this time) | `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))` |
| Requests waiting for a database connection | `pg_pool_waiting_count` |
