# Disaster recovery

Use this guide to restore the database and avatars after data loss.
Run commands from the project root.

## Backups

| Topic | Rule |
| --- | --- |
| Automatic | Check at startup, after backend health, then at midnight universal time. Skip days with a complete backup. Retry failures after one hour. |
| Manual | `make backup` creates an extra backup. The database must be running. |
| Location | `./backups` on the host. `make clean` does not delete it. |
| Keep | All backups from the last seven backed-up days in universal time, plus the newest from each of the last four backed-up calendar weeks (Monday to Sunday). These can overlap. |
| Settings | `DAILY_KEEP` must be above zero; `WEEKLY_KEEP` can be zero. Delete older copies only after a successful backup. |
| Safety | A file lock prevents overlapping runs. A database lock pauses user changes until database and avatar capture finish. Failed captures do not change `latest.ok`. |
| Access | Backup folders are private to the backup user. Host admin access may be needed. |
| Maximum data loss | At most 24 hours of changes, while backups succeed. |
| Recovery time target | 30 minutes for this small dataset, with Docker, images and backups ready. Not yet timed. |

| File | Purpose |
| --- | --- |
| `<snapshot>/database.dump` | PostgreSQL 17 backup: users, password hashes, sessions, accounts, transactions, reference data and migrations. |
| `<snapshot>/avatars.tar.gz` | Avatar files. |
| `<snapshot>/completed.ok` | Completion time in universal time. |
| `<snapshot>/week` | Calendar week used to choose which backups to keep. |
| `backups/latest.ok` | Last successful backup time; updated only when both files succeed. |
| `backups/overview.txt` | Available folders, universal times, sizes in kibibytes (1,024 bytes) and results. Updated after backup cleanup and daily skips. `Successful` means the files exist, not that recovery was tested. |

If migrating from fixed `expense_db-data` / `expense_avatar-data` volumes, keep the old volumes and an external backup until recovery is verified; data is not moved automatically.

## Create a backup

Backups can run while the app is open. User changes, including avatar changes,
wait until capture finishes. You may stop the backend first to avoid waiting requests.

| Step | Command |
| --- | --- |
| 1. Optional: stop writes; keep database running | `docker compose stop backend` |
| 2. Back up | `make backup` |
| 3. Start services | `make up` |
| 4. List backups | `cat backups/overview.txt` |
| 5. Check status | `curl --cacert nginx/certs/ca/rootCA.pem https://localhost:8443/status` |
| Check failures | `make logs` (Ctrl+C to exit) |

After `make up`, use `docker compose ps` to check service health.
`make stop` stops the database too, so use the backend-only command above.
Check disk space if a backup fails. Keep the last good copy.

## Restore a backup

**Restore deletes current database and avatar data. Use only trusted backups.**

| Step | Action |
| --- | --- |
| 1. Choose | Select a complete backup folder. Use its matching dump and avatar archive, PostgreSQL 17 and the matching app version. |
| 2. Protect current data | Make another backup if possible. Allow space for a temporary database and avatar copy. Do not run other backups or restores at the same time. |
| 3. Prepare | Run `make build` if needed, then `make up`. |
| 4. Restore | `make restore BACKUP=backups/<snapshot> CONFIRM=--confirm` |
| 5. Check services | Run `docker compose ps` and check `/health` and `/status`. |
| 6. Check data | Log in again. Compare balances, transactions and avatars with the saved values. Healthy services alone do not prove data recovery. |
| 7. Record | Record the date, results and time taken. Keep the backup until all checks pass. |

The direct command is `sh scripts/restore.sh backups/<snapshot> --confirm`.

The restore script checks the backup, stops backend/backup writes, tests recovery in temporary storage, then replaces data and restarts services.
On failure, backend and backups stay stopped; inspect the error before restarting. There is no automatic rollback to the previous data.

## Status checks

| Check | Meaning |
| --- | --- |
| `/health` | Database readiness; response code 503 if unavailable. Used by backend health checks. |
| Frontend health | Compose checks `/` and waits for backend health at startup. |
| `/status` | Always response code 200 with `Cache-Control: no-store`. Read the `status` field in the response. No private error details are exposed. |
| `ok` | Database and avatar storage checks pass; backup is no older than 36 hours. |
| `down` | Database check fails. |
| `degraded` | Database works, but storage is not writable or the backup time is missing, unreadable, invalid, in the future or over 36 hours old. |
| Timeouts | Status checks use a separate connection pool with three-second limits. Other routes keep their existing connection behavior. |
| Local setup | Set `AVATAR_DIR` and `BACKUP_MARKER_PATH` when running outside Docker. |

## Recovery drill

Use a separate project copy with its own `backups/` directory and `COMPOSE_PROJECT_NAME=drill`; stop the normal app first to free its ports.
Keep that project name and directory for every backup, clean and restore command; never run destructive drill commands in the normal project.
Create test data, record balances and avatar contents, run `make backup`, then `make clean`, `make up` and restore the saved snapshot using the procedure above.
Verify login, balances, transaction counts and avatars, and record results and elapsed time.
Stop the drill stack and unset `COMPOSE_PROJECT_NAME` before returning to the normal project.

A full restore drill passed on 2026-11-02, confirmed by the user; login, balances, transactions and avatars were restored, but elapsed time was not recorded.
Run `python3 scripts/backup.check.py` for backup-script checks; the isolated database recovery check is below.

### Isolated database check

This check uses temporary storage without host ports or saved data volumes; its password is only for this disposable container.

```sh
docker build -f scripts/backup.Dockerfile -t transcendence-recovery-check scripts
docker run --rm --network none \
  --tmpfs /var/lib/postgresql/data --tmpfs /backups --tmpfs /avatars \
  -v "$PWD/scripts:/scripts:ro" \
  -e POSTGRES_USER=expense -e POSTGRES_PASSWORD=RecoveryCheck123 \
  -e POSTGRES_DB=expense_tracker -e PGUSER=expense \
  -e PGPASSWORD=RecoveryCheck123 -e PGDATABASE=expense_tracker \
  -e PGHOST=127.0.0.1 -e RECOVERY_CHECK_DISPOSABLE=yes \
  --entrypoint sh transcendence-recovery-check /scripts/recovery.check.sh
```

## Limits

| Limit | Effect |
| --- | --- |
| Local, unencrypted backups | Contain personal data and password hashes. Host loss, disk failure or ransomware can destroy data and backups. Restrict access; add encrypted off-site copies before production use. |
| No point-in-time recovery | Changes after the chosen backup are lost. |
| User changes pause during backup | A table lock delays registration, profile changes, password changes and avatar changes. Reads and transaction entries continue. Use finer locks if backups become slow. |
| Container must run | Long shutdowns miss backups. Status shows stale backups but sends no alerts. |
| Basic storage check | Tests write permission, not free space or durable writes. |
| Restore can fail | Source checks run before data replacement. Later disk or database failures can still leave partial data with writers stopped. Keep a known good backup. |
