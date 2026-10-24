#!/usr/bin/env bash
# Cron every 30 min as root:  */30 * * * * /opt/yogesh-portfolio/deploy/check-disk.sh
# Raises an alert (journal, ALERT_WEBHOOK_URL, ALERT_EMAIL) when disk use passes the threshold.
THRESHOLD="${THRESHOLD:-85}"
for path in /var/lib/yogesh-portfolio /srv/yp; do
  [ -d "$path" ] || continue
  use=$(df --output=pcent "$path" | tail -1 | tr -dc '0-9')
  if [ "$use" -ge "$THRESHOLD" ]; then
    msg="DISK WARNING: $path is ${use}% full on $(hostname)"
    logger -p user.crit -t yp-disk "$msg"
    "$(dirname "$0")/alert.sh" "$msg"
  fi
done
