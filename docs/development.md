# Development and operations

[Back to project README](../README.md)

Run commands from the repository root unless stated otherwise; see the README for prerequisites and initial Docker setup.

## Google sign-in setup

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the OAuth consent screen as External/Testing and add allowed test users.
3. Create a Web application OAuth client with redirect URI exactly `https://localhost:3000/auth/google`; add the deployed origin's `/auth/google` when applicable.
4. Add these credentials to the git-ignored root `.env`, then run `make up`:

   ```env
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```

For host development, put both variables in `backend/.env` and only `GOOGLE_CLIENT_ID` in `frontend/.env.local`; without credentials, Google sign-in returns an error.

## Two-factor authentication

Generate an encryption key with `openssl rand -base64 32` and set `TOTP_ENCRYPTION_KEY` in root `.env` for Docker, or `backend/.env` for host development.
Without a key, 2FA setup is disabled; the backend refuses to start if any user already has 2FA enabled. Keep the key safe: losing or changing it requires affected users to use recovery codes and set up 2FA again.
Enable it under Profile → Two-factor authentication, scan the QR code, enter a code and save the ten recovery codes shown once; password and Google sign-ins then require a second step.

## Environment and HTTPS notes

Keep secrets out of Git and never expose a client secret through a `NEXT_PUBLIC_*` variable.
Compose forwards only explicitly configured variables from the root `.env`; change service environment settings in `docker-compose.yml` for custom addresses.
Docker exposes the app only through Nginx at `https://localhost:3000` and API `https://localhost:8443`; internal app connections use HTTP. Compose sets secure cookies and trusts one proxy hop. Host-only development below uses local HTTP; use Docker when HTTPS is required.

## Local HTTPS

Install mkcert before `make up`; the Makefile creates certificates in git-ignored `nginx/certs/` and trusts the local CA:

```bash
# macOS; nss adds Firefox support
brew install mkcert nss
# Debian/Ubuntu; libnss3-tools adds browser trust support
sudo apt install mkcert libnss3-tools
```

Other systems: [mkcert installation](https://github.com/FiloSottile/mkcert#installation).
On Linux, open the browser once first so its certificate store exists; mkcert may ask for sudo to update system trust.
Without sudo, use `TRUST_STORES=nss make certs` with `certutil` installed. Restart the browser after setup.
Never share the private `rootCA-key.pem` from `mkcert -CAROOT`, or bypass verification with `curl -k` or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

```bash
curl --cacert nginx/certs/ca/rootCA.pem https://localhost:8443/health
NODE_EXTRA_CA_CERTS=nginx/certs/ca/rootCA.pem node my-script.mjs
```

For `502 Bad Gateway` after recreating frontend/backend containers, run `docker compose restart nginx`.
To regenerate certificates, delete only `nginx/certs/`, then run `make down` and `make up`.

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
Do not run Docker app servers on the same ports. The default avatar folder is `/app/avatars`; host uploads require write access there, while Docker provides this storage automatically.
Host mode does not start the backup scheduler, so `/status` may report `degraded` without a successful backup marker.

## Database operations

Compose uses development-only user/password `expense` and database `expense_tracker`; committed migrations apply at backend startup and leave 17 reference currencies.

| Task | Command |
|---|---|
| PostgreSQL shell | `docker compose exec db psql -U expense -d expense_tracker` |
| Apply migrations manually | `docker compose exec backend npm run db:migrate` |
| Generate after changing `backend/srcs/db/schema.ts` | `docker compose exec backend npm run db:generate`; commit generated `backend/drizzle/` files. |

Migration `0008_remove_user_deleted_at` aborts if soft-deleted users exist; resolve them explicitly before retrying to avoid restoring access.
PostgreSQL initialization credentials apply only when the volume is first created; changing configuration does not update an existing database.
Data persists in `db-data` and `avatar-data` (mounted at `/app/avatars`).
See [disaster recovery](disaster-recovery.md) for backup storage, retention, limitations and restore instructions.

## Dependencies and hot reload

Run `npm ci` inside `backend/` or `frontend/` for a clean locked installation; keep lockfiles.
For intentional changes, use `npm install <package>` and commit the manifest and lockfile, then run `make rebuild` to refresh container dependencies.
Host installs do not update container dependency volumes; rebuilding preserves named database/avatar/monitoring volumes.
Source bind mounts provide Next.js reload and backend restart without rebuilding.
Containers run as `node` (UID 1000); on Linux, bind mounts must be writable, including `backend/drizzle/` for migrations and `frontend/` for `.next`.

## Stack modes

`make up` starts the full stack; `make dev` starts database, backend, frontend, Nginx and backups. Both create missing certificates and require the root environment values; use `make down` before switching to dev to stop existing monitoring containers.

## Reset

**Back up first: `make clean` deletes database, avatar and monitoring volumes; host `./backups` survives.**
For normal stopping/restarting, use `make down` and `make up`; use `make logs` to diagnose failures.
