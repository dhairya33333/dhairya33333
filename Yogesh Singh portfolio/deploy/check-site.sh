#!/usr/bin/env bash
# Cron every 5 min:  */5 * * * * /opt/yogesh-portfolio/deploy/check-site.sh
# Checks the live /healthz. Alerts after 2 failures in a row (so one blip is ignored) and again when the site recovers.
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -r /etc/yogesh-portfolio/env ] && { set -a; . /etc/yogesh-portfolio/env; set +a; }
URL="${HEALTH_URL:-${SITE_URL:-http://127.0.0.1:3000}/healthz}"
STATE=/var/tmp/yp-site-fails
if curl -fsS -m 10 "$URL" | grep -q '"ok":true'; then
  [ -f "$STATE" ] && [ "$(cat "$STATE")" -ge 2 ] && "$DIR/alert.sh" "RECOVERED: $URL is answering again."
  rm -f "$STATE"
else
  n=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STATE"
  [ "$n" -eq 2 ] && "$DIR/alert.sh" "SITE DOWN: $URL has not answered for 10 minutes."
fi
exit 0
