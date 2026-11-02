#!/bin/sh
set -eu

# Manual runs always create a backup.
if [ "${1:-}" = once ]; then
  exec sh /scripts/backup.sh
fi

seconds_per_day=86400
retry_delay_seconds=3600

# Wait until midnight after success; retry failures after one hour.
while :; do
  if sh /scripts/backup.sh --daily; then
    delay_seconds=$((seconds_per_day - $(date -u +%s) % seconds_per_day))
  else
    echo "Backup failed; will retry in one hour" >&2
    delay_seconds=$retry_delay_seconds
  fi
  # Wait on a child so shutdown can interrupt the sleep.
  sleep "$delay_seconds" &
  wait $!
done
