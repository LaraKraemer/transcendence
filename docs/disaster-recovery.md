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

## Storage name change

Fixed `expense_db-data` and `expense_avatar-data` names have been removed. Older
project-prefixed volumes are used again. If you used the fixed names, make a
backup and copy it outside `backups/` before updating. Stop the old stack with
`make down` before updating, then use `make up` and restore that backup. Keep the
old volumes until login, balances and avatars are verified. No data is moved or
deleted automatically by this change.

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
| 7. Record | Add the date, results and time taken to the drill log. Keep the backup until all checks pass. |

The direct command is `sh scripts/restore.sh backups/<snapshot> --confirm`.

| Script step | What happens |
| --- | --- |
| Validate | Require `--confirm`, a nonempty completion marker and both backup files. Read the full dump and archive. |
| Stop writes | Stop backend and scheduled backups, then take the backup lock. |
| Test source | Restore into a temporary database and extract avatars into a temporary folder. Failure leaves current data untouched. |
| Restore | Recreate the database, restore its dump in a transaction, replace avatars and set file ownership. |
| Restart | Start services and check `/health`. |
| Failure | Errors explain why restore stopped. Backend and backups stay stopped after restore failure. Check the error before running `make up` with the same project settings. There is no automatic return to previous data. |

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

| Response field | Value |
| --- | --- |
| `status` | `ok`, `degraded` or `down`. |
| `components.database.status` | `ok` or `down`. |
| `components.database.latencyMs` | Database check time in milliseconds. |
| `components.storage.status` | Whether the backend user can write to the avatar folder. |
| `uptimeSeconds` | Backend uptime in seconds. |
| `version` | Backend package version. |
| `lastBackupAt` | Last successful backup time, or null if no valid time is available. |

## Recovery drill

A drill tests whether a backup can recover real data.
**Use a copy of the project, not your normal working folder.**

### Prepare the test project

| Step | Action |
| --- | --- |
| 1. Stop the normal app | In your normal `transcendence` folder, run `make stop` before setting the test project name. This frees its ports without deleting data. |
| 2. Copy the project | Copy the whole `transcendence` folder to a separate folder named `transcendence-drill`, for example using your file manager. A second clone also works. |
| 3. Keep backups separate | The copy must use its own `backups/` folder. Do not link it to the original folder. You may copy a selected backup into it. |
| 4. Select the test project | Open a terminal in `transcendence-drill` and run the commands below. |

Example folder layout:

```text
Desktop/
├── transcendence/        # normal project
└── transcendence-drill/  # separate copy for the drill
```

In the test folder, run:

```sh
export COMPOSE_PROJECT_NAME=drill
make up
```

The setting gives the test its own containers, data volumes and network. It does
not separate ports or backup folders; that is why the normal app is stopped and
the project is copied. To run both apps at once, change the test ports and matching
app addresses instead.

**Keep this terminal open for every drill command**, including `make clean` and
`make restore`. In a new terminal, select the test folder and export the same
project name again before running commands. Never run the drill in the original
project folder.

### Run the drill

| Step | Action |
| --- | --- |
| 1. Create data | Add a user, avatar, account, income, expenses and transfers. Save balances and avatar bytes. |
| 2. Back up | Stop backend, run `make backup` and record the folder name. Keep an extra copy outside `backups/`. |
| 3. Delete test data | Run `make clean`, then `make up`. Confirm the old user cannot log in. |
| 4. Restore | Follow the restore steps above using the recorded backup. |
| 5. Verify | Check login, balances, transaction counts and avatar bytes. Record the time taken. |
| Script check | Run `python3 scripts/backup.check.py`. Tests scheduling, cleanup, overview and missing-file guards using fake database, lock and Docker commands. |
| Isolated database check | Use the command below. Tests real locks, damaged dumps, broken archives and successful recovery with temporary storage. Your app data is not mounted. |
| Server smoke test | From `backend/bruno`, run `TEST_PASSWORD='<at-least-12-characters>' ../node_modules/.bin/bru run --env local`. Set the server address to the test stack. |

### Return to the normal project

After recording the results, run `make stop` in the test folder. Then clear the
test project setting before starting your normal project:

```sh
unset COMPOSE_PROJECT_NAME
cd ../transcendence
make up
```

### Isolated database check

Build the small test image, then run it without host ports or saved volumes:

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

The test password is for this disposable container only. This check does not
replace the full app drill with login, balances and avatars.

### Drill log

| Date | Setup | Result |
| --- | --- | --- |
| 2026-11-02 | Fresh local stack; backup `2026-11-02T095546Z-FFGMEF`; `test1@example.com` and `test2@example.com` | **Passed, confirmed by the user.** Both logins worked. Each user had 50 entries: 20 income, 20 expenses and 10 transfers. Avatars matched. Time taken was not recorded; the recovery time target remains unverified. |

| User | Expected and restored Everyday balance | Expected and restored Savings balance |
| --- | --- | --- |
| `test1@example.com` | €1,530.05 | €585.35 |
| `test2@example.com` | €1,560.05 | €595.35 |

## Limits

| Limit | Effect |
| --- | --- |
| Local, unencrypted backups | Contain personal data and password hashes. Host loss, disk failure or ransomware can destroy data and backups. Restrict access; add encrypted off-site copies before production use. |
| No point-in-time recovery | Changes after the chosen backup are lost. |
| User changes pause during backup | A table lock delays registration, profile changes, password changes and avatar changes. Reads and transaction entries continue. Use finer locks if backups become slow. |
| Container must run | Long shutdowns miss backups. Status shows stale backups but sends no alerts. |
| Basic storage check | Tests write permission, not free space or durable writes. |
| Restore can fail | Source checks run before data replacement. Later disk or database failures can still leave partial data with writers stopped. Keep a known good backup. |
