# Development and operations

[Back to project README](../README.md)

Run commands from the repository root unless stated otherwise; see the README for prerequisites and initial Docker setup.

## Contents

- [Google sign-in setup](#google-sign-in-setup)
- [Running Without Docker](#running-without-docker)
- [Database operations](#database-operations)
- [Docker commands](#docker-commands)
- [Dependencies and hot reload](#dependencies-and-hot-reload)
- [Troubleshooting](#troubleshooting)
- [Git workflow](#git-workflow)

## Google sign-in setup

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen as External/Testing and add allowed test users.
3. Create a Web application OAuth client with redirect URI exactly `http://localhost:3000/auth/google`; add the deployed origin's `/auth/google` when applicable.
4. Add these credentials to the git-ignored root `.env`, then run `make up`:

   ```env
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```

For host development, put both variables in `backend/.env` and only `GOOGLE_CLIENT_ID` in `frontend/.env.local`; without credentials, Google sign-in returns an error.

## Running Without Docker

1. Select Node.js 22 using the root `.nvmrc`, configure the root monitoring `.env` as described in the [README](../README.md#docker-development), and start PostgreSQL 17 (the command below starts only the database):

   ```bash
   nvm install
   nvm use
   docker compose up -d db
   ```

2. Create `backend/.env`:

   ```env
   DATABASE_URL=postgres://expense:expense@localhost:5432/expense_tracker
   FRONTEND_ORIGIN=http://localhost:3000
   AVATAR_DIR=./avatars
   ```

3. Start the backend; migrations apply automatically:

   ```bash
   cd backend
   npm ci
   npm run dev
   ```

4. In another terminal, from the repository root, start the frontend:

   ```bash
   cd frontend
   cp .env.example .env.local
   npm ci
   npm run dev
   ```

The frontend example sets `API_URL` and `NEXT_PUBLIC_API_URL` to `http://localhost:3001`.
Open http://localhost:3000 and verify `curl -fsS http://localhost:3001/health`.
Do not run Docker app servers on the same ports; `AVATAR_DIR` must be writable.
Host mode does not start the backup scheduler, so `/status` may report `degraded` without a successful backup marker.

## Database operations

Compose uses development-only user/password `expense` and database `expense_tracker`; committed migrations apply at backend startup and leave 17 reference currencies.

| Task | Command |
|---|---|
| PostgreSQL shell | `docker compose exec db psql -U expense -d expense_tracker` |
| Inspect tables / transactions in psql | `\dt` / `SELECT * FROM "transaction";` |
| Apply migrations manually | `docker compose exec backend npm run db:migrate` |
| Generate after changing `backend/srcs/db/schema.ts` | `docker compose exec backend npm run db:generate`; commit generated `backend/drizzle/` files. |

Migration `0008_remove_user_deleted_at` aborts if soft-deleted users exist; resolve them explicitly before retrying to avoid restoring access.
PostgreSQL initialization credentials apply only when the volume is first created; changing configuration does not update an existing database.
Data persists in `db-data` and `avatar-data` (mounted at `/app/avatars`, overridable with `AVATAR_DIR`).
See [disaster recovery](disaster-recovery.md) for backup storage, retention, limitations and restore instructions.

## Docker commands

| Command | Purpose |
|---|---|
| `make up` | Start services; build missing images. |
| `make down` | Remove containers/networks; preserve volumes. |
| `make stop` | Stop containers without removing them. |
| `make build` | Build service images without starting containers. |
| `make rebuild` | Rebuild images and renew anonymous dependency volumes. |
| `make restart` | Recreate containers, preserving data. |
| `make logs` | Follow service logs. |
| `make clean` | **Delete containers and database/avatar/monitoring volumes**; preserve host backups. |
| `make backup` | Create a database/avatar backup. |
| `make restore BACKUP=backups/<snapshot> CONFIRM=--confirm` | Replace database/avatar data from a trusted snapshot. |
| `make prune` | Prune unused Docker resources across projects, including images; Docker asks for confirmation. |

## Dependencies and hot reload

Run `npm ci` inside `backend/` or `frontend/` for a clean locked installation; keep lockfiles.
For intentional changes, use `npm install <package>` and commit the manifest and lockfile, then run `make rebuild` to refresh container dependencies.
Host installs do not update container dependency volumes; rebuilding preserves named database/avatar/monitoring volumes.
Source bind mounts provide Next.js reload and backend restart without rebuilding.
Containers run as `node` (UID 1000); on Linux, bind mounts must be writable, including `backend/drizzle/` for migrations and `frontend/` for `.next`.

## Troubleshooting

Inspect `docker ps` for port conflicts and `make logs` for startup errors.
For a data-preserving restart, use `make down` followed by `make up`.

**Back up before a complete reset: `make clean` deletes database, avatar and monitoring volumes; host `./backups` survives.**

```bash
make clean
make rebuild
```

## Git workflow

Branch from `main`, use Conventional Commit subjects and open a GitHub pull request:

```bash
git checkout main
git pull --ff-only
git checkout -b feature/<feature-name>
```

```bash
git add -p
git commit -m "docs: update project documentation"
git push origin feature/<feature-name>
```
