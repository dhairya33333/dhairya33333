#!/usr/bin/env bash
# Nightly backup. Run from cron as the portfolio user:  15 3 * * *  /opt/yogesh-portfolio/deploy/backup.sh
# 1) consistent database copy (kept 14 days)  2) optional off-server copy of the database AND the original films
# Writes backups/status.json so Admin -> Dashboard can show whether the last run (and the off-server copy) worked, and raises an alert if not.
set -uo pipefail
APP=/opt/yogesh-portfolio
set -a; . /etc/yogesh-portfolio/env; set +a
cd "$APP"
B="${BACKUP_DIR:-$DATA_DIR/backups}"
now() { date -u +"%Y-%m-%d %H:%M UTC"; }
status() { printf '{"at":"%s","db_ok":%s,"remote":%s,"remote_ok":%s}\n' "$(now)" "$1" "$2" "$3" > "$B/status.json"; }

if ! node scripts/backup-db.js; then
  status false false false; deploy/alert.sh "BACKUP FAILED: the database backup did not complete on $(hostname)."; exit 1
fi

# Off-server copy. Set BACKUP_REMOTE in /etc/yogesh-portfolio/env, e.g. user@backup-host:/backups/yp  (rsync over SSH)
# A VPS snapshot is NOT a substitute: keep at least one copy of the originals somewhere else.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  ok=true
  rsync -a --partial "$B/" "$BACKUP_REMOTE/db/" || ok=false
  rsync -a --partial "${SOURCE_DIR:-$DATA_DIR/private/source}/" "$BACKUP_REMOTE/originals/" || ok=false
  rsync -a --partial "$DATA_DIR/uploads/" "$BACKUP_REMOTE/uploads/" || ok=false
  status true true $ok
  $ok || { deploy/alert.sh "OFF-SERVER BACKUP FAILED on $(hostname): the database was backed up locally but could not be copied to $BACKUP_REMOTE."; exit 1; }
else
  status true false false
fi
