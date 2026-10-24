#!/usr/bin/env bash
# Nightly backup. Run from cron as the portfolio user:  15 3 * * *  /opt/yogesh-portfolio/deploy/backup.sh
# 1) consistent database copy (kept 14 days)  2) optional off-server copy of database AND original films
set -euo pipefail
APP=/opt/yogesh-portfolio
set -a; . /etc/yogesh-portfolio/env; set +a
cd "$APP"
node scripts/backup-db.js

# Off-server copy. Set BACKUP_REMOTE in /etc/yogesh-portfolio/env, e.g. user@backup-host:/backups/yp  (rsync over SSH)
# A VPS snapshot is NOT a substitute: keep at least one copy of the originals somewhere else.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --partial "${BACKUP_DIR:-$DATA_DIR/backups}/" "$BACKUP_REMOTE/db/"
  rsync -a --partial "${SOURCE_DIR:-$DATA_DIR/private/source}/" "$BACKUP_REMOTE/originals/"
  rsync -a --partial "$DATA_DIR/uploads/" "$BACKUP_REMOTE/uploads/"
fi
