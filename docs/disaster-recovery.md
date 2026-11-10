# Disaster recovery

Run commands from the project root. Backups cover PostgreSQL data and avatar files, not monitoring data.

## Backup policy

- Backups run after startup and daily at midnight UTC; failed attempts retry after one hour
- Snapshots are stored in host `./backups`
- Retention keeps the last seven backed-up days and the newest backup from each of the last four backed-up weeks
- Backups are local and unencrypted; restrict access and keep a separate copy to protect against host loss
- Changes after the chosen snapshot are lost; successful daily backups limit this to about 24 hours
- The recovery target is 30 minutes, but recovery time has not been measured

Each complete snapshot contains `database.dump`, `avatars.tar.gz` and `completed.ok`.
`backups/overview.txt` lists snapshots; a successful capture does not prove that restoration works.

## Create a backup

Keep PostgreSQL running; do not use `make stop` before backing up.

```bash
make backup
cat backups/overview.txt
```

Backups briefly delay user/profile/avatar changes. If a backup fails, inspect `make logs`, check disk space and keep the last good snapshot.
Automatic backups require the backup container to be running.

## Restore a backup

**Restore replaces current database and avatar data. Use only trusted backups.**

1. Select a complete snapshot with matching database/avatar files, PostgreSQL 17 and a compatible app version.
2. Back up current data if possible and allow space for a temporary database and avatar copy; do not run another backup or restore at the same time.
3. Run `make build` if needed, then `make up`.
4. Restore the chosen snapshot:

   ```bash
   make restore BACKUP=backups/<snapshot> CONFIRM=--confirm
   ```

5. Check services and backup status:

   ```bash
   docker compose ps
   curl --cacert nginx/certs/ca/rootCA.pem https://localhost:8443/health
   curl --cacert nginx/certs/ca/rootCA.pem https://localhost:8443/status
   ```

6. Log in and compare balances, transaction counts and avatars with the saved values; keep the snapshot until all checks pass.

The script tests the snapshot in temporary storage before replacing data.
If restoration fails, backend and backups stay stopped; inspect the error before restarting.
Later failures can leave partial data: there is no automatic rollback.

## Status

- `ok`: database and avatar storage checks pass; the last backup is no older than 36 hours
- `down`: the database check failed
- `degraded`: the database works, but avatar storage is not writable or the backup timestamp is missing, invalid or stale

`/status` returns HTTP 200 even when degraded or down; read its `status` field.

## Recovery drill

- Use a separate project copy, separate `backups/` folder and `COMPOSE_PROJECT_NAME=drill`; stop the normal app to free its ports
- Keep that directory and project name for every command; never run destructive drill commands in the normal project
- Create test data, record balances and avatars, back up, follow the [reset warning](../README.md#operations), run `make clean` and `make up`, then restore the snapshot
- Verify login, balances, transaction counts and avatars; record the date, results and elapsed time
- Stop the drill stack and unset `COMPOSE_PROJECT_NAME` before returning to the normal project

The full restore drill passed on 2026-11-02, confirmed by the user; elapsed time was not recorded.
