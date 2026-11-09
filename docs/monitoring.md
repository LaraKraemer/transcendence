# Monitoring

Run commands from the repository root. Components, metrics and alert conditions
are listed in the [README](../README.md#monitoring).

## 1. Initial setup (once per installation)

1. Copy `.env.example` to `.env` if missing. Set these values; generate passwords
   with `openssl rand -hex 24`:

   **Environment variables**

   | Variable | Purpose |
   |---|---|
   | `POSTGRES_EXPORTER_PASSWORD` | Password for the database user created below |
   | `GRAFANA_ADMIN_USER` | Initial Grafana admin username |
   | `GRAFANA_ADMIN_PASSWORD` | Initial Grafana admin password |

2. Start the stack. Compose waits for PostgreSQL, then `monitoring-db-init`
   creates the restricted `monitoring` user and sets its password from `.env`.
   The exporter starts only after this succeeds. No manual SQL setup is needed.

   ```bash
   make up
   ```

   Setup also works after `make clean` and when the monitoring user already exists.
   After changing the exporter password, run `docker compose up -d` to update both
   the database role and the exporter. `docker compose restart` does not rerun setup.
   Use `make rebuild` instead after dependency changes. Grafana loads its data
   source and dashboards automatically; no manual dashboard creation is needed.

3. For Telegram, obtain the shared bot token and intended group ID privately from the maintainer.
   Create the local directory:

   ```bash
   mkdir -p .secrets
   chmod 700 .secrets
   ```

4. Save the values in your editor, without quotes or variable names:

   **Telegram credential files**

   | File | Content |
   |---|---|
   | `.secrets/telegram_bot_token` | Bot token only |
   | `.secrets/telegram_chat_id` | Group ID only, including its leading minus sign |

   ```bash
   chmod 644 .secrets/telegram_bot_token .secrets/telegram_chat_id
   ```

5. Add this line to the existing root `.env` on macOS/Linux:

   ```dotenv
   COMPOSE_FILE=docker-compose.yml:docker-compose.telegram.yml
   ```

6. Validate and activate:

   ```bash
   sh scripts/monitoring.check.sh
   docker compose up -d --force-recreate alertmanager
   docker compose restart prometheus
   ```

> **Info:** Telegram sends **FIRING** and **RESOLVED** to the configured group. Outbound Internet
> access is required. Repeat the activation commands after changing credentials.
> To disable Telegram, remove `COMPOSE_FILE` and recreate Alertmanager.

<br>

## 2. Daily use

### Access and daily commands

| Resource | Access |
|---|---|
| Grafana | http://localhost:3002; login with the Grafana credentials from `.env` |
| Dashboards | **Expense Tracker** → **Backend-Dashboard** / **Database-Dashboard** |
| Alerts | http://localhost:3002/alerting/list; Prometheus data source-managed rules |
| Pause / resume | `make stop` / `make up` |


> **Info:** To keep dashboard edits, export them back to the JSON files in `monitoring/grafana/dashboards/`.


### Temporary Prometheus access

| Step | Action / command |
|---|---|
| Default access | Prometheus, exporters, Alertmanager and backend metrics port 9100 are internal only |
| 1. Open without Telegram | `docker compose -f docker-compose.yml -f docker-compose.monitoring-debug.yml up -d prometheus` |
| 1. Open with Telegram | `docker compose -f docker-compose.yml -f docker-compose.telegram.yml -f docker-compose.monitoring-debug.yml up -d prometheus` |
| 2. View scrape targets | http://localhost:9090/targets |
| 2. View alert states | http://localhost:9090/alerts |
| 3. Close debug access | `docker compose up -d --force-recreate prometheus` (uses the normal root `.env` configuration) |
| 4. Verify closure | `docker compose ps` must show `9090/tcp` without a host mapping such as `127.0.0.1:9090->9090/tcp` |
| After closing | Grafana and Telegram continue to work |

## 3. Verification

### Configuration and security checks

| Check | Expected result |
|---|---|
| `sh scripts/monitoring.check.sh` | Valid Compose, five rules and both receiver configurations; no messages sent |
| `sh scripts/monitoring-db.check.sh` | Fresh/repeated role setup, password rotation and restricted permissions on a disposable database |
| Prometheus Targets | Backend, Prometheus, PostgreSQL exporter and cAdvisor are UP |
| `pg_up{job="postgres-exporter"}` | `1` |
| Existing [Bruno smoke test](../README.md#local-api-testing) | Passes; Grafana traffic panels change |
| Fresh private browser at http://localhost:3002/dashboards | Login required |
| `curl -i http://localhost:3001/metrics` | HTTP 404 |
| `docker compose ps` after closing debug access | No host-port mappings for internal monitoring services |

Backend checks: see [Code Checks](../README.md#code-checks) and
[Unit Tests](../README.md#unit-tests).

### Live Telegram delivery test

| Step | Action | Expected result |
|---|---|---|
| 1 | `docker compose stop backend` | Backend stops |
| 2 | Wait about two minutes | **BackendDown** becomes **Firing**; Telegram receives **FIRING** |
| 3 | `docker compose start backend` | Backend starts |
| 4 | Wait until healthy and the alarm clears | Telegram receives **RESOLVED**, usually within another minute |

Wait for each state change before continuing. If delivery fails:

```bash
docker compose logs --since=10m alertmanager
```

Check the group ID, bot permissions, token and network. Stopping the entire stack
also stops monitoring. `make clean` deletes database and monitoring data volumes.
