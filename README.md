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

# Add the sample expenses (safe to re-run)
docker compose exec backend npm run db:seed
```

Inside `psql`, list tables with `\dt` and inspect transactions with:

```sql
SELECT * FROM "transaction";
```

Run `docker compose exec backend npm run db:generate` only after changing
`backend/srcs/db/schema.ts`; commit the generated files in `backend/drizzle/`.

Database data is stored in the `db-data` Docker volume and survives normal
container restarts. `make clean` removes that volume and permanently deletes
your local database data. PostgreSQL reads its initial user, password, and
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
| `POST` | `/auth/logout` | Revoke the current session |
| `GET` | `/auth/me` | Return the current authenticated user |

Example registration request:

```bash
curl -i -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-secure-password","displayName":"Your name"}' \
  http://localhost:3001/auth/register
```

Passwords must be 12 to 72 bytes. Password hashes, not passwords, are stored
in the database. Google and other provider logins will be added later through
a separate account-identity table.

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
| Transactions | `GET`, `POST` `/transactions`; `GET`, `PATCH`, `DELETE` `/transactions/:transactionId` |

`PATCH /accounts/:accountId` rejects a different `currencyCode` with `409` while
transactions currently exist in the account. Submitting the current currency used is allowed. Accounts without transactions may change currency, even with an opening
balance; this does not convert the opening balance, so we need to review and adjust it as needed.

`GET /transactions` requires an `accountId` query parameter. Account and
category deletion archives the resource; transaction deletion permanently removes the row.


<br>

# Local API Testing

The repository includes a Bruno collection for repeatable local API testing in
`backend/bruno/`. It registers a disposable user, creates an account, category,
and transaction, then updates and deletes that transaction.

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

Backend CI runs these checks and unit tests, plus the complete Bruno collection
against a fresh PostgreSQL 17 database. API startup applies migrations; CI waits
for `/health` before running requests and prints the API log if a step fails.

From `frontend/`, run `npm ci`, `npm run lint` and `npm run build`. Frontend CI
runs lint and build. Both workflows run on relevant pull requests and pushes to
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
| `tests/routes/protection.test.ts` | all 16 protected routes reject unauthenticated requests |
| `tests/routes/account.test.ts` | account CRUD + balance |
| `tests/routes/category.test.ts` | category CRUD |
| `tests/routes/transaction.test.ts` | transaction CRUD + category sign rule |
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
