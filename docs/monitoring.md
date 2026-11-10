# Poolaki monitoring

Run commands from the repository root; `make up` starts monitoring, while `make dev` does not.

## Setup

1. Copy `.env.example` to `.env` if missing, then replace these placeholders; generate passwords with `openssl rand -hex 24`:

   ```env
   POSTGRES_EXPORTER_PASSWORD=<monitoring-database-password>
   GRAFANA_ADMIN_USER=<grafana-admin-username>
   GRAFANA_ADMIN_PASSWORD=<grafana-admin-password>
   ```

2. Run `make up`; Compose creates the monitoring database user and Grafana loads its dashboards automatically.
   After changing the exporter password, run `docker compose up -d` to update the database role and exporter; restarting alone does not apply the change.

### Telegram alerts

1. Obtain the bot token and group ID privately from the maintainer, then create the secret directory:

   ```bash
   mkdir -p .secrets
   chmod 700 .secrets
   ```

2. In your editor, save only the token in `.secrets/telegram_bot_token` and only the group ID in `.secrets/telegram_chat_id`, including any leading minus sign; do not add quotes or variable names.
   Keep the directory private while allowing the container to read its files:

   ```bash
   chmod 644 .secrets/telegram_bot_token .secrets/telegram_chat_id
   ```

3. Add this to the existing root `.env` on macOS/Linux:

   ```env
   COMPOSE_FILE=docker-compose.yml:docker-compose.telegram.yml
   ```

4. Validate and activate; repeat after changing Telegram credentials:

   ```bash
   sh scripts/monitoring.check.sh
   docker compose up -d --force-recreate alertmanager
   docker compose restart prometheus
   ```

Telegram sends **FIRING** and **RESOLVED** messages and needs outbound Internet access.
To disable delivery, remove `COMPOSE_FILE` and recreate Alertmanager.
Never commit `.env` or `.secrets/`.

## Access

| Resource | Location |
|---|---|
| Grafana | http://localhost:3002; sign in with the credentials from `.env` |
| Dashboards | Poolaki → Backend-Dashboard / Database-Dashboard |
| Alerts | http://localhost:3002/alerting/list |

Prometheus, Alertmanager, exporters and backend metrics stay inside Docker; do not expose their unauthenticated ports.
Dashboard files are in `monitoring/grafana/`; alert rules are in `monitoring/alerts.yml`.

## Verify alerts

- Run `sh scripts/monitoring.check.sh` to validate configuration without sending messages
- Open Grafana in a private browser window and confirm login is required
- In Grafana Explore, check `up{job="backend"}` and `pg_up{job="postgres-exporter"}` both return `1`

Alerts cover backend/database/exporter availability, high error rate, slow responses and database connection queues.

### Telegram delivery test

1. Run `docker compose stop backend`; leave monitoring running.
2. Wait about two minutes for a **BackendDown FIRING** message.
3. Run `docker compose start backend`.
4. Wait for the backend to recover and a **RESOLVED** message, usually within another minute.

If no message arrives, check the group ID, bot permissions, token and network, then inspect:

```bash
docker compose logs --since=10m alertmanager
```
