#!/bin/sh
# Check exporter-user setup on a disposable database; never touches project volumes.
set -eu
cd "$(dirname "$0")/.."

database_container=$(docker run -d --network none \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=expense -e POSTGRES_PASSWORD=test-only-admin \
  -e POSTGRES_DB=expense_tracker \
  -v "$PWD/monitoring/db-init.sql:/monitoring/db-init.sql:ro" \
  postgres:17-alpine)
trap 'docker rm -f "$database_container" >/dev/null' EXIT HUP INT TERM

attempt=0
until docker exec "$database_container" pg_isready -h 127.0.0.1 -U expense -d expense_tracker >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Disposable PostgreSQL did not become ready" >&2
    exit 1
  fi
  sleep 1
done

# First run, repeated setup and password rotation; the first password tests SQL quoting.
for exporter_password in "test-only-'quoted-password" "test-only-'quoted-password" "test-only-rotated-password"; do
  docker exec -e POSTGRES_EXPORTER_PASSWORD="$exporter_password" "$database_container" \
    psql -X -v ON_ERROR_STOP=1 -U expense -d expense_tracker -f /monitoring/db-init.sql
  actual=$(docker exec -e PGPASSWORD="$exporter_password" "$database_container" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U monitoring -d expense_tracker -Atc \
    "SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolreplication, pg_has_role(current_user, 'pg_monitor', 'member'), has_database_privilege(current_user, 'expense_tracker', 'CONNECT') FROM pg_roles WHERE rolname = current_user")
  if [ "$actual" != "monitoring|f|f|f|f|t|t" ]; then
    echo "Unexpected exporter role privileges" >&2
    exit 1
  fi
done
echo "Fresh setup, repeated setup, password rotation and monitoring privileges passed."
