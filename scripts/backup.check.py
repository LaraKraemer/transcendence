#!/usr/bin/env python3
"""Check backup scripts with temporary files and fake database commands."""
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

backup_script = Path(__file__).with_name("backup.sh").resolve()
with tempfile.TemporaryDirectory() as temporary_directory:
    root = Path(temporary_directory)
    commands = root / "bin"
    commands.mkdir()
    for name, body in {
        "flock": "exit 0",
        "psql": (
            "cat >/dev/null\n"
            'pg_dump --format=custom --file="$SNAPSHOT_DIRECTORY/database.dump"\n'
            'tar -czf "$SNAPSHOT_DIRECTORY/avatars.tar.gz" -C "$AVATAR_DIR" .'
        ),
        "pg_dump": (
            'test "${PGHOST:-}" != fail || exit 1\n'
            'for arg; do case "$arg" in --file=*) printf dump > "${arg#--file=}";; esac; done'
        ),
    }.items():
        command = commands / name
        command.write_text("#!/bin/sh\nset -eu\n" + body + "\n")
        command.chmod(0o755)

    avatars = root / "avatars"
    avatars.mkdir()
    (avatars / "sample.png").write_bytes(b"avatar")
    backups = root / "backups"
    backups.mkdir()

    # Include duplicate days, shared weeks and older backups.
    snapshots = {
        "2020-01-01T120000Z-test": "2020-01",
        "2020-01-08T120000Z-test": "2020-02",
        "2020-01-15T120000Z-test": "2020-03",
        "2020-01-21T120000Z-test": "2020-04",
        "2020-01-22T110000Z-test": "2020-04",
        "2020-01-22T120000Z-test": "2020-04",
    }
    today = datetime.now(timezone.utc)
    recent_snapshot = today.strftime("%Y-%m-%dT000000Z-seed")
    snapshots[recent_snapshot] = today.strftime("%G-%V")
    for name, week in snapshots.items():
        snapshot = backups / name
        snapshot.mkdir()
        (snapshot / "completed.ok").touch()
        (snapshot / "week").write_text(week)

    environment = dict(
        os.environ,
        PATH=str(commands) + os.pathsep + os.environ["PATH"],
        BACKUP_DIR=str(backups),
        AVATAR_DIR=str(avatars),
        DAILY_KEEP="1",
        WEEKLY_KEEP="2",
    )
    backup_command = ["sh", str(backup_script)]
    subprocess.run(backup_command, env=environment, check=True)
    remaining = list(backups.glob("*/completed.ok"))
    assert len(remaining) == 3, remaining
    assert (backups / "2020-01-22T120000Z-test").is_dir()
    assert (backups / recent_snapshot).is_dir()

    overview = (backups / "overview.txt").read_text()
    overview_lines = overview.splitlines()
    overview_rows = [line.split() for line in overview_lines[1:]]
    assert {row[1] for row in overview_rows} == {path.parent.name for path in remaining}
    assert all(int(row[2]) >= 0 for row in overview_rows)
    assert sum(row[3] == "Successful" for row in overview_rows) == 1
    assert "2020-01-01T120000Z-test" not in overview
    assert "\t" not in overview
    result_column = overview_lines[0].index("Result")
    assert all(
        line[result_column:] in ("Successful", "Incomplete")
        for line in overview_lines[1:]
    ), overview

    # Skip a completed day without needing the database.
    backup_marker = (backups / "latest.ok").read_bytes()
    subprocess.run(
        [*backup_command, "--daily"], env=dict(environment, PGHOST="fail"), check=True
    )
    assert (backups / "latest.ok").read_bytes() == backup_marker
    assert len(list(backups.glob("*/completed.ok"))) == 3

    # Failed captures must leave backups, marker and overview unchanged.
    for failure_settings in ({"PGHOST": "fail"}, {"AVATAR_DIR": str(root / "missing")}):
        result = subprocess.run(backup_command, env=dict(environment, **failure_settings))
        assert result.returncode != 0
        assert (backups / "latest.ok").read_bytes() == backup_marker
        assert (backups / "overview.txt").read_text() == overview
        assert len(list(backups.glob("*/completed.ok"))) == 3
        assert not list(backups.glob(".pending-*"))

    # An incomplete folder must not prevent a daily backup.
    daily_backups = root / "daily-backups"
    incomplete = daily_backups / recent_snapshot
    incomplete.mkdir(parents=True)
    (incomplete / "completed.ok").touch()
    (incomplete / "week").write_text(today.strftime("%G-%V"))
    daily_environment = dict(environment, BACKUP_DIR=str(daily_backups))
    subprocess.run([*backup_command, "--daily"], env=daily_environment, check=True)
    assert (daily_backups / "latest.ok").is_file()
    assert len(list(daily_backups.glob("*/database.dump"))) == 1

    # Manual runs add a backup even when today's backup exists.
    subprocess.run(backup_command, env=daily_environment, check=True)
    assert len(list(daily_backups.glob("*/database.dump"))) == 2
    daily_overview = (daily_backups / "overview.txt").read_text()
    assert daily_overview.count("Successful") == 2
    assert daily_overview.count("Incomplete") == 1

    # Empty or missing files must stop restore before Docker runs.
    docker_log = root / "docker-calls"
    docker = commands / "docker"
    docker.write_text('#!/bin/sh\nprintf "%s\\n" "$1 $2 $3 $4 $5 $6" >> "$RESTORE_CHECK_LOG"\nif [ "${RESTORE_CHECK_FAIL:-}" = yes ]; then\n  case "$*" in *restore-data.sh*) exit 1;; esac\nfi\n')
    docker.chmod(0o755)
    restore_environment = dict(environment, RESTORE_CHECK_LOG=str(docker_log))
    backup_files = ("completed.ok", "database.dump", "avatars.tar.gz")
    for missing_name in backup_files:
        source = root / ("missing-" + missing_name)
        source.mkdir()
        for name in backup_files:
            (source / name).write_text("test" if name != missing_name else "")
        for file_state in ("empty", "missing"):
            if file_state == "missing":
                (source / missing_name).unlink()
            result = subprocess.run(
                ["sh", str(backup_script.with_name("restore.sh")), str(source), "--confirm"],
                env=restore_environment,
                capture_output=True,
            )
            assert result.returncode != 0
            assert b"Backup is incomplete" in result.stderr
            assert not docker_log.exists()

    # Every restore command must use the chosen project and Compose file.
    source = root / "complete-backup"
    source.mkdir()
    for name in backup_files:
        (source / name).write_text("test")
    subprocess.run(
        ["make", "restore", f"BACKUP={source}", "CONFIRM=--confirm",
         "COMPOSE=docker compose -p recovery-drill -f drill.yml"],
        cwd=backup_script.parent.parent,
        env=restore_environment,
        capture_output=True,
        check=True,
    )
    docker_calls = docker_log.read_text().splitlines()
    assert len(docker_calls) == 6, docker_calls
    assert all(call.startswith("compose -p recovery-drill -f drill.yml ") for call in docker_calls)
    result = subprocess.run(
        ["make", "restore", f"BACKUP={source}", "CONFIRM=--confirm",
         "COMPOSE=docker compose -p recovery-drill -f drill.yml"],
        cwd=backup_script.parent.parent,
        env=dict(restore_environment, RESTORE_CHECK_FAIL="yes"),
        capture_output=True,
    )
    assert result.returncode != 0
    assert b"Backend and backup remain stopped" in result.stderr
    assert len(docker_log.read_text().splitlines()) == 10


print("Backup scheduling, retention, overview and restore guard checks passed")
