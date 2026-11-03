#!/bin/sh
set -eu
# Let the backend read completion markers. Snapshot folders remain private.
umask 022
backup_directory=${BACKUP_DIR:-/backups}
daily_retention_count=${DAILY_KEEP:-7}
weekly_retention_count=${WEEKLY_KEEP:-4}

# Color terminal messages only; leave logs and errors unchanged.
progress_green=
progress_reset=
if [ -t 1 ] && [ -z "${NO_COLOR+x}" ]; then
  progress_green=$(printf '\033[32m')
  progress_reset=$(printf '\033[0m')
fi

# Check retention settings before changing files.
for retention_count in "$daily_retention_count" "$weekly_retention_count"; do
  case "$retention_count" in
    ''|*[!0-9]*)
      echo "Retention counts must be nonnegative integers" >&2
      exit 1
      ;;
  esac
done
if [ "$daily_retention_count" -eq 0 ]; then
  echo 'DAILY_KEEP must be positive' >&2
  exit 1
fi

mkdir -p "$backup_directory"
# Manual and scheduled backups share this lock; crashes release it.
exec 9>"$backup_directory/.lock"
if ! flock -n 9; then
  echo 'Another backup or restore is running; try again later.' >&2
  exit 1
fi

# Skip existing daily backups only for scheduled runs.
if [ "${1:-}" = --daily ]; then
  backup_day=$(date -u +%Y-%m-%d)
  for snapshot_directory in "$backup_directory/$backup_day"T*; do
    if [ -f "$snapshot_directory/completed.ok" ] &&
       [ -s "$snapshot_directory/database.dump" ] &&
       [ -s "$snapshot_directory/avatars.tar.gz" ]; then
      printf '%s%s%s\n' "$progress_green" "Today's backup already exists; skipping automatic backup" "$progress_reset"
      sh "$(dirname "$0")/backup-overview.sh"
      exit 0
    fi
  done
fi

# Remove partial captures on failure.
temporary_directory=$(mktemp -d "$backup_directory/.pending-XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM
# Avatar deletion follows a user update. Block updates until both captures finish.
# ponytail: this blocks all user-record writes; use finer locks if backups become slow.
export SNAPSHOT_DIRECTORY="$temporary_directory"
export AVATAR_DIR="${AVATAR_DIR:-/avatars}"
psql -X --quiet --set=ON_ERROR_STOP=on \
  --set=progress_green="$progress_green" --set=progress_reset="$progress_reset" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '10s';
\echo :progress_green Waiting for user changes to pause... :progress_reset
LOCK TABLE public.app_user IN SHARE MODE;
\echo :progress_green Saving the database and avatar files... :progress_reset
\! pg_dump --format=custom --file="$SNAPSHOT_DIRECTORY/database.dump" && tar -czf "$SNAPSHOT_DIRECTORY/avatars.tar.gz" -C "$AVATAR_DIR" .
\if :SHELL_ERROR
  DO $$ BEGIN RAISE EXCEPTION 'Backup capture failed'; END $$;
\endif
COMMIT;
\echo :progress_green Capture complete. User changes can continue. :progress_reset
SQL

# Publish both files before updating the last-backup time.
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
backup_week=$(date -u +%G-%V)
printf '%s\n' "$backup_week" > "$temporary_directory/week"
printf '%s\n' "$completed_at" > "$temporary_directory/completed.ok"
snapshot_name=$(date -u +%Y-%m-%dT%H%M%SZ)-${temporary_directory##*-}
mv "$temporary_directory" "$backup_directory/$snapshot_name"
printf '%s\n' "$completed_at" > "$backup_directory/.latest.tmp"
mv "$backup_directory/.latest.tmp" "$backup_directory/latest.ok"

# Count days and weeks from newest to oldest.
retained_day_count=0
retained_week_count=0
previous_snapshot_day=
previous_snapshot_week=
find "$backup_directory" -mindepth 1 -maxdepth 1 -type d -name '????-??-??T*' | sort -r |
while IFS= read -r snapshot_directory; do
  [ -f "$snapshot_directory/completed.ok" ] || continue
  snapshot_day=$(basename "$snapshot_directory" | cut -c1-10)
  if [ "$snapshot_day" != "$previous_snapshot_day" ]; then
    retained_day_count=$((retained_day_count + 1))
    previous_snapshot_day=$snapshot_day
  fi
  snapshot_week=$(cat "$snapshot_directory/week")
  keep_weekly=false
  if [ "$snapshot_week" != "$previous_snapshot_week" ]; then
    retained_week_count=$((retained_week_count + 1))
    previous_snapshot_week=$snapshot_week
    [ "$retained_week_count" -gt "$weekly_retention_count" ] || keep_weekly=true
  fi
  # Retain every recent daily copy and the newest copy in each retained week.
  if [ "$retained_day_count" -gt "$daily_retention_count" ] && [ "$keep_weekly" = false ]; then
    rm -rf "$snapshot_directory"
  fi
done

# List the remaining backups.
sh "$(dirname "$0")/backup-overview.sh"
printf '%sBackup saved: %s/%s%s\n' "$progress_green" "$backup_directory" "$snapshot_name" "$progress_reset"
