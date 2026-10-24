#!/usr/bin/env bash
# Sends one alert to whatever is configured in /etc/yogesh-portfolio/env: ALERT_WEBHOOK_URL (Slack, Discord, ntfy.sh, or anything that
# accepts a JSON POST with a "text" field) and/or ALERT_EMAIL (needs `mail`). Usage: alert.sh "message"
set -u
[ -r /etc/yogesh-portfolio/env ] && { set -a; . /etc/yogesh-portfolio/env; set +a; }
msg="$*"
logger -p user.crit -t yp-alert "$msg"
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  esc=${msg//\\/\\\\}; esc=${esc//\"/\\\"}
  curl -fsS -m 15 -H 'Content-Type: application/json' -d "{\"text\":\"$esc\",\"content\":\"$esc\"}" "$ALERT_WEBHOOK_URL" >/dev/null || logger -t yp-alert "webhook failed"
fi
[ -n "${ALERT_EMAIL:-}" ] && echo "$msg" | mail -s "Website alert" "$ALERT_EMAIL" || true
