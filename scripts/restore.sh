#!/bin/sh
set -eu

# Read relative paths from the project root.
cd "$(dirname "$0")/.."

# Refuse destructive changes without confirmation.
if [ "$#" -ne 2 ] || [ "$2" != --confirm ]; then
  echo 'Usage: scripts/restore.sh backups/<snapshot> --confirm (replaces database and avatars)' >&2
  exit 1
fi

backup_directory=$(cd "$1" && pwd)
if [ ! -s "$backup_directory/completed.ok" ] ||
   [ ! -s "$backup_directory/database.dump" ] ||
   [ ! -s "$backup_directory/avatars.tar.gz" ]; then
  echo 'Backup is incomplete: completion marker, database dump and avatar archive are required.' >&2
  exit 1
fi
# Read both files before stopping services. Use trusted backups only.
docker compose run --rm --no-deps -v "$backup_directory:/restore:ro" --entrypoint sh backup -ec '
  pg_restore --exit-on-error --file=/dev/null /restore/database.dump
  tar -tzf /restore/avatars.tar.gz >/dev/null
'

# Stop writes and scheduled backups.
docker compose stop backup backend
docker compose up -d --wait db
# Restart only if restore succeeds.
docker compose run --rm --no-deps -v "$backup_directory:/restore:ro" --entrypoint sh backup /scripts/restore-data.sh

# Start services and check the database.
docker compose up -d --wait backend frontend backup
docker compose exec -T backend node -e 'fetch("http://127.0.0.1:3001/health").then(r=>{if(!r.ok)process.exit(1)})'
