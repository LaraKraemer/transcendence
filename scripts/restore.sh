#!/bin/sh
set -eu

# Match the Compose command used by Make, including project and file options.
compose() {
  ${COMPOSE:-docker compose} "$@"
}

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
compose run --rm --no-deps -v "$backup_directory:/restore:ro" --entrypoint sh backup -ec '
  pg_restore --exit-on-error --file=/dev/null /restore/database.dump
  tar -tzf /restore/avatars.tar.gz >/dev/null
'

# Stop writes and scheduled backups.
compose stop backup backend
compose up -d --wait db
# Restart only if restore succeeds.
if ! compose run --rm --no-deps -v "$backup_directory:/restore:ro" --entrypoint sh backup /scripts/restore-data.sh; then
  echo 'Restore failed. Backend and backup remain stopped. Check the error before restarting with make up using the same Compose settings.' >&2
  exit 1
fi

# Start services and check the database.
compose up -d --wait backend frontend backup
compose exec -T backend node -e 'fetch("http://127.0.0.1:3001/health").then(r=>{if(!r.ok)process.exit(1)})'
