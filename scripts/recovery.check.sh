#!/bin/sh
# Run only in a disposable container with empty storage.
set -eu
if [ "${RECOVERY_CHECK_DISPOSABLE:-}" != yes ]; then
  echo 'This check requires an isolated disposable container.' >&2
  exit 1
fi

# Start the test database.
docker-entrypoint.sh postgres >/tmp/recovery-postgres.log 2>&1 &
postgres_process_id=$!
trap 'kill "$postgres_process_id"; wait "$postgres_process_id" || true' EXIT
trap 'exit 1' HUP INT TERM
readiness_attempts=0
until pg_isready -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  readiness_attempts=$((readiness_attempts + 1))
  if [ "$readiness_attempts" -ge 30 ]; then
    cat /tmp/recovery-postgres.log >&2
    exit 1
  fi
  sleep 1
done

psql -X --set=ON_ERROR_STOP=on <<'SQL'
CREATE TABLE app_user (id integer PRIMARY KEY, avatar_url text);
INSERT INTO app_user VALUES (1, 'avatar.png');
CREATE TABLE entry (id integer PRIMARY KEY, amount_minor integer NOT NULL, note text);
INSERT INTO entry SELECT n, n * 100, md5(n::text) FROM generate_series(1, 1000) n;
SQL
mkdir -p /avatars /backups /restore /tmp/recovery-tools
printf 'original-avatar' > /avatars/avatar.png

# A user update must stay blocked while avatars are captured.
export REAL_TAR=$(command -v tar)
cat > /tmp/recovery-tools/tar <<'WRAPPER'
#!/bin/sh
set -eu
if PGOPTIONS='-c lock_timeout=300ms' psql -X --set=ON_ERROR_STOP=on -c "UPDATE app_user SET avatar_url='changed.png' WHERE id=1" >/tmp/competing-update.log 2>&1; then
  echo 'Backup allowed a concurrent avatar change' >&2
  exit 1
fi
grep -q 'lock timeout' /tmp/competing-update.log
touch /tmp/avatar-lock-tested
if [ "${RECOVERY_FORCE_ARCHIVE_FAILURE:-}" = yes ]; then exit 1; fi
exec "$REAL_TAR" "$@"
WRAPPER
chmod +x /tmp/recovery-tools/tar
PATH="/tmp/recovery-tools:$PATH" sh /scripts/backup.sh
[ -f /tmp/avatar-lock-tested ]
snapshot_directory=$(find /backups -mindepth 1 -maxdepth 1 -type d -name '????-??-??T*')
cp "$snapshot_directory/database.dump" "$snapshot_directory/avatars.tar.gz" "$snapshot_directory/completed.ok" /restore/

# A failed capture must preserve existing backups and their timestamp.
cp /backups/latest.ok /tmp/previous-marker
if RECOVERY_FORCE_ARCHIVE_FAILURE=yes PATH="/tmp/recovery-tools:$PATH" sh /scripts/backup.sh >/tmp/failed-capture.log 2>&1; then
  echo 'A failed archive capture unexpectedly succeeded' >&2
  exit 1
fi
cmp /backups/latest.ok /tmp/previous-marker
[ "$(find /backups -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1 ]

# Reject a second backup while the file lock is held.
flock /backups/.lock sh -c 'touch /tmp/backup-lock-held; sleep 3' &
lock_process_id=$!
while [ ! -f /tmp/backup-lock-held ]; do sleep 0.1; done
if sh /scripts/backup.sh; then
  echo 'An overlapping backup unexpectedly succeeded' >&2
  exit 1
fi
cmp /backups/latest.ok /tmp/previous-marker
wait "$lock_process_id"

# Extra data must survive failed restores.
psql -X --set=ON_ERROR_STOP=on -c "INSERT INTO app_user VALUES (2, 'keep.png')"
printf 'keep-avatar' > /avatars/keep.png
cp /restore/database.dump /tmp/complete.dump
# Damage the saved data without breaking the contents list.
dump_size_bytes=$(wc -c < /tmp/complete.dump)
dd if=/tmp/complete.dump of=/restore/database.dump bs=1 count=$((dump_size_bytes - 1024)) 2>/dev/null
pg_restore --list /restore/database.dump >/dev/null
if pg_restore --exit-on-error --file=/dev/null /restore/database.dump >/tmp/invalid-stream.log 2>&1; then
  echo 'A damaged dump passed full-stream validation' >&2
  exit 1
fi
if sh /scripts/restore-data.sh >/tmp/invalid-dump.log 2>&1; then
  echo 'A damaged dump unexpectedly restored' >&2
  exit 1
fi
[ "$(psql -X -Atc 'SELECT count(*) FROM app_user')" = 2 ]
[ "$(cat /avatars/keep.png)" = keep-avatar ]
cp /tmp/complete.dump /restore/database.dump

cp /restore/avatars.tar.gz /tmp/complete-avatars.tar.gz
printf 'broken archive' > /restore/avatars.tar.gz
if sh /scripts/restore-data.sh >/tmp/invalid-avatar.log 2>&1; then
  echo 'A damaged avatar archive unexpectedly restored' >&2
  exit 1
fi
[ "$(psql -X -Atc 'SELECT count(*) FROM app_user')" = 2 ]
[ "$(cat /avatars/keep.png)" = keep-avatar ]
cp /tmp/complete-avatars.tar.gz /restore/avatars.tar.gz

# A successful restore must replace data and remove the extra avatar.
sh /scripts/restore-data.sh
[ "$(psql -X -Atc 'SELECT count(*) FROM app_user')" = 1 ]
[ "$(psql -X -Atc 'SELECT sum(amount_minor) FROM entry')" = 50050000 ]
[ "$(cat /avatars/avatar.png)" = original-avatar ]
[ ! -e /avatars/keep.png ]
[ "$(stat -c %u:%g /avatars)" = 1000:1000 ]
[ "$(stat -c %u:%g /avatars/avatar.png)" = 1000:1000 ]
[ "$(psql -X -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'restore_validation_%'")" = 0 ]
echo 'Real backup, concurrent locks, damaged sources and restore checks passed'
