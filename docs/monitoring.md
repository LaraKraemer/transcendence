# Poolaki monitoring

Run commands from the repository root. Components and metrics are listed in the [monitoring reference](#monitoring-reference) below.

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
| Dashboards | **Poolaki** → **Backend-Dashboard** / **Database-Dashboard** |
| Alerts | http://localhost:3002/alerting/list; Prometheus data source-managed rules |
| Pause / resume | `make stop` / `make up` |


> **Info:** To keep dashboard edits, export them back to the JSON files in `monitoring/grafana/dashboards/`.

For an existing installation, if dashboards remain in **Expense Tracker**, delete
the new **Poolaki** folder only if it is empty, then rename **Expense Tracker** to
**Poolaki** in Grafana. Fresh installations create the **Poolaki** folder automatically.


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
| `sh scripts/monitoring.check.sh` | Valid Compose, six rules and both receiver configurations; no messages sent |
| `sh scripts/monitoring-db.check.sh` | Fresh/repeated role setup, password rotation and restricted permissions on a disposable database |
| Prometheus Targets | Backend, Prometheus, PostgreSQL exporter and cAdvisor are UP |
| `pg_up{job="postgres-exporter"}` | `1` |
| Existing [Bruno smoke test](testing.md#api-smoke-tests) | Passes; Grafana traffic panels change |
| Fresh private browser at http://localhost:3002/dashboards | Login required |
| `curl -i --cacert nginx/certs/ca/rootCA.pem https://localhost:8443/metrics` | HTTP 404 |
| `docker compose ps` after closing debug access | No host-port mappings for internal monitoring services |

Backend checks: see [Code Checks](testing.md#local-checks) and
[Unit Tests](testing.md#backend).

`BackendDown` covers an unreachable backend; `PostgresExporterDown` covers an
unreachable exporter. `PostgresDown` means the exporter is running but cannot
connect to PostgreSQL. Error-rate, latency and pool-queue rules evaluate available
measurements rather than duplicating the service-down alarms.

### Live Telegram delivery test

| Step | Action | Expected result |
|---|---|---|
| 1 | `docker compose stop backend` | Backend stops |
| 2 | Wait about two minutes | **BackendDown** becomes **Firing**; Telegram receives **FIRING** |
| 3 | `docker compose start backend` | Backend starts |
| 4 | Wait until healthy and the alarm clears | Telegram receives **RESOLVED**, usually within another minute |

To test exporter availability instead, stop/start `postgres-exporter` with the
same commands. Expect `PostgresExporterDown` and its recovery message.

Wait for each state change before continuing. If delivery fails:

```bash
docker compose logs --since=10m alertmanager
```

Check the group ID, bot permissions, token and network. Stopping the entire stack
also stops monitoring. `make clean` deletes database and monitoring data volumes.

## Monitoring reference
“Internal” means a service is available inside Docker, without a port open on your computer.

### Services and access

| Service | What it does | Access |
|---|---|---|
| Prometheus | Collects measurements and checks the alert rules in `monitoring/alerts.yml` | Internal; use the debug Compose file for temporary browser access |
| Grafana | Shows the Backend and Database dashboards in the **Poolaki** folder | http://localhost:3002; log in with the admin details from the root `.env` |
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
| Backend setup | No database table changes; `METRICS_HOST` controls the metrics listener address |
| Metrics access | Keep port 9100 inside Docker; it has no login protection |
| Running without Docker | Port 9100 defaults to `127.0.0.1`; Compose sets `METRICS_HOST=0.0.0.0` for internal scraping |

### Backend measurements

| Metric | Labels | What it measures |
|---|---|---|
| `http_request_duration_seconds` | `method`, `route`, `status_code` | Request times in seconds, grouped into time buckets; `_count` counts requests |
| `users_registered_total` | — | New password or Google users saved successfully |
| `logins_total` | `result`: `success` or `failure` | Completed password/Google logins or rejected credentials, including 2FA codes |
| `transactions_created_total` | — | Saved transaction rows: 1 for a normal transaction, 2 for a transfer, one per imported row |
| `pg_pool_connections` | `state`: `total` or `idle` | Total database connections and connections that are free to use |
| `pg_pool_waiting_count` | — | Requests waiting for a free database connection |
| `process_*`, `nodejs_*` | Depends on the metric | Standard Node.js measurements, such as CPU and memory use |

### How counting works

| Item | Behavior |
|---|---|
| Counters | Start again when the backend restarts; deleting data does not reduce them |
| Registration | Counts saved password users and committed Google registrations, even if later session creation fails |
| Failed database changes | Changes that fail or are undone do not count |
| Failed logins | Counts rejected passwords, Google codes and 2FA/recovery codes; pending 2FA is not a success; rate limits and server errors remain HTTP metrics |
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
