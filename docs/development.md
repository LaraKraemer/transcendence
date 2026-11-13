# Development and operations

[Back to project README](../README.md)


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
Without a key, 2FA setup is disabled; the backend refuses to start if any user already has 2FA enabled.

## Environment and HTTPS notes

Compose forwards only explicitly configured variables from the root `.env`; change service environment settings in `docker-compose.yml` for custom addresses.
Docker exposes the app only through Nginx at `https://localhost:3000` and API `https://localhost:8443`.

## Local HTTPS

`make up` creates certificates in git-ignored `nginx/certs/` with mkcert and trusts the local CA. When mkcert is not on `PATH`, the Makefile downloads it into `~/.local/bin`, so no sudo is needed. To install it yourself instead:

```bash
# macOS; nss adds Firefox support
brew install mkcert nss
# Debian/Ubuntu; libnss3-tools adds browser trust support
sudo apt install mkcert libnss3-tools
```

Other systems: [mkcert installation](https://github.com/FiloSottile/mkcert#installation).

- On Linux, open the browser once first so its certificate store exists.
- Without sudo, `make certs` asks for the sudo password, fails to update the system trust store and still creates the certificate. The browser then shows a certificate warning: accept it once for `https://localhost:3000` and once for `https://localhost:8443/health`, or API requests fail. In Chrome, select **Advanced → Proceed to localhost (unsafe)**; in Firefox, **Advanced → Accept the Risk and Continue**.
- Restart the browser after setup.

Never share the private `rootCA-key.pem` from `mkcert -CAROOT`, or bypass verification with `curl -k` or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

```bash
curl --cacert nginx/certs/ca/rootCA.pem https://localhost:8443/health
NODE_EXTRA_CA_CERTS=nginx/certs/ca/rootCA.pem node my-script.mjs
```

For `502 Bad Gateway` after recreating frontend/backend containers, run `docker compose restart nginx`. To regenerate certificates, delete only `nginx/certs/`, then run `make down` and `make up`.

## Running Without Docker

1. Select Node.js 22 using the root `.nvmrc`, configure the root monitoring `.env` as described in the [README](../README.md#docker-development), and start PostgreSQL 17 (the command below starts only the database):

   ```bash
   nvm install
   nvm use
   docker compose up -d db
   ```

2. Create `backend/.env` with the database credentials from the root `.env`:

   ```env
   DATABASE_URL=postgres://<database-user>:<database-password>@localhost:5432/expense_tracker
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

- Do not run Docker and host app servers on the same ports
- Host avatar uploads need write access to `/app/avatars`; Docker provides this storage automatically
- Host mode does not start automatic backups, so `/status` may report `degraded` if its backup marker is missing or stale

## Database operations

Compose uses development-only user/password `expense` and database `expense_tracker`; committed migrations apply at backend startup and leave 17 reference currencies.

| Task | Command |
|---|---|
| PostgreSQL shell | `docker compose exec db psql -U expense -d expense_tracker` |
| Apply migrations manually | `docker compose exec backend npm run db:migrate` |
| Generate after changing `backend/srcs/db/schema.ts` | `docker compose exec backend npm run db:generate`; commit generated `backend/drizzle/` files. |

Database and avatar data survive container restarts in named volumes. Changing PostgreSQL initialization credentials does not update an existing database.
See [disaster recovery](disaster-recovery.md) for backup storage, retention, limitations and restore instructions.

## Dependencies

After dependency changes, commit the manifest and lockfile, then run `make rebuild` to refresh container dependencies

## Stopping services

For normal stopping/restarting, use `make down` and `make up`; use `make logs` to diagnose failures.
