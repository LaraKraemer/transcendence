#!/bin/sh
# Called by restore.sh after the backend stops.
set -eu

# Prevent backups from running during restore.
exec 9>/backups/.lock
if ! flock -n 9; then
  echo 'Another backup or restore is running; try again later.' >&2
  exit 1
fi
if [ ! -s /restore/completed.ok ] ||
   [ ! -s /restore/database.dump ] ||
   [ ! -s /restore/avatars.tar.gz ]; then
  echo 'Backup is incomplete.' >&2
  exit 1
fi

validation_directory=$(mktemp -d /avatars/.restore-XXXXXX)
validation_database=restore_validation_${validation_directory##*-}
validation_database_created=false
cleanup() {
  if [ "$validation_database_created" = true ]; then
    dropdb --if-exists "$validation_database" || echo "Could not remove validation database" >&2
  fi
  rm -rf "$validation_directory"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# Test both backups before deleting current data.
createdb "$validation_database"
validation_database_created=true
pg_restore --exit-on-error --single-transaction --no-owner --dbname="$validation_database" /restore/database.dump
tar -xzf /restore/avatars.tar.gz -C "$validation_directory"
chown -R 1000:1000 "$validation_directory"

# Replace the database only after validation succeeds.
dropdb --if-exists --force "$PGDATABASE"
createdb "$PGDATABASE"
pg_restore --exit-on-error --single-transaction --no-owner --dbname="$PGDATABASE" /restore/database.dump

# Replace avatars; cp -a keeps the ownership set above.
find /avatars -mindepth 1 -maxdepth 1 ! -name "$(basename "$validation_directory")" -exec rm -rf {} +
cp -a "$validation_directory/." /avatars/
chown 1000:1000 /avatars
