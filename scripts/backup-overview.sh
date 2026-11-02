#!/bin/sh
set -eu

backup_directory=${BACKUP_DIR:-/backups}
# Write separately, then replace the overview when complete.
temporary_overview=$(mktemp "$backup_directory/.overview-XXXXXX")
trap 'rm -f "$temporary_overview"' EXIT HUP INT TERM
# Fixed widths keep columns aligned in text editors.
row_format='%-22s  %-32s  %18s  %s\n'
{
  printf "$row_format" 'Completed (UTC)' 'Folder' 'Size (KiB on disk)' 'Result'
  # List backup folders newest first.
  find "$backup_directory" -mindepth 1 -maxdepth 1 -type d -name '????-??-??T*' | sort -r |
  while IFS= read -r snapshot_directory; do
    # Files alone do not prove recovery works.
    result=Incomplete
    if [ -f "$snapshot_directory/completed.ok" ] &&
       [ -s "$snapshot_directory/database.dump" ] &&
       [ -s "$snapshot_directory/avatars.tar.gz" ]; then
      result=Successful
    fi
    completed_at=$(cat "$snapshot_directory/completed.ok" 2>/dev/null || true)
    # Measure disk space, not uncompressed size.
    size_kib=$(du -sk "$snapshot_directory" | cut -f1)
    printf "$row_format" "${completed_at:-unknown}" "$(basename "$snapshot_directory")" "$size_kib" "$result"
  done
} > "$temporary_overview"

mv "$temporary_overview" "$backup_directory/overview.txt"
