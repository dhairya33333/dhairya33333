#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04/24.04 VPS. Run as root:  bash setup-vps.sh example.com you@email.com
# Copy the project folder to /opt/yogesh-portfolio BEFORE running this. Safe to re-run.
set -euo pipefail
DOMAIN="${1:?domain, e.g. example.com}"; EMAIL="${2:?email for the HTTPS certificate}"
APP=/opt/yogesh-portfolio
DATA=/var/lib/yogesh-portfolio

apt-get update
apt-get install -y nginx ffmpeg certbot python3-certbot-nginx curl ca-certificates ufw openssl rsync fail2ban logrotate
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

id portfolio &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin portfolio
mkdir -p "$DATA" /srv/yp/{originals,hls,incoming,tmp,backups} /etc/yogesh-portfolio
cd "$APP"
npm ci --omit=dev

if [ ! -f /etc/yogesh-portfolio/env ]; then
  cp .env.example /etc/yogesh-portfolio/env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|; s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|" /etc/yogesh-portfolio/env
  # keep originals, HLS, incoming, tmp and backups on their own directories (mount separate volumes here if you have them)
  sed -i 's|^# SOURCE_DIR=.*|SOURCE_DIR=/srv/yp/originals|; s|^# MEDIA_DIR=.*|MEDIA_DIR=/srv/yp/hls|; s|^# INCOMING_DIR=.*|INCOMING_DIR=/srv/yp/incoming|; s|^# UPLOAD_TMP_DIR=.*|UPLOAD_TMP_DIR=/srv/yp/tmp|; s|^# BACKUP_DIR=.*|BACKUP_DIR=/srv/yp/backups|' /etc/yogesh-portfolio/env
fi
chmod 600 /etc/yogesh-portfolio/env
chown -R portfolio:portfolio "$DATA" /srv/yp
chmod 700 "$DATA" /srv/yp/originals /srv/yp/hls /srv/yp/tmp /srv/yp/backups
chmod 2770 /srv/yp/incoming     # group-writable drop folder: add your SFTP user to the 'portfolio' group (usermod -aG portfolio USER)
chmod 711 /srv/yp               # others may not list it
chown -R root:portfolio "$APP"; chmod -R g+rX,o-rwx "$APP"

cp deploy/yogesh-portfolio.service /etc/systemd/system/
mkdir -p /etc/systemd/journald.conf.d && cp deploy/journald-yp.conf /etc/systemd/journald.conf.d/yp.conf && systemctl restart systemd-journald
sed "s/example.com/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/yogesh-portfolio
ln -sf /etc/nginx/sites-available/yogesh-portfolio /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

systemctl daemon-reload && systemctl enable --now yogesh-portfolio
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect

# cron: nightly backup (as portfolio) and disk check (as root)
chmod +x deploy/*.sh
( crontab -u portfolio -l 2>/dev/null | grep -v backup.sh; echo "15 3 * * * $APP/deploy/backup.sh >> /var/log/yp-backup.log 2>&1" ) | crontab -u portfolio -
( crontab -l 2>/dev/null | grep -v check-disk.sh; echo "*/30 * * * * $APP/deploy/check-disk.sh" ) | crontab -
touch /var/log/yp-backup.log && chown portfolio /var/log/yp-backup.log
cat > /etc/logrotate.d/yp-backup <<'LR'
/var/log/yp-backup.log { weekly rotate 8 compress missingok notifempty }
LR

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
systemctl enable --now fail2ban
echo
echo "Done. Next:"
echo "  1) edit /etc/yogesh-portfolio/env  (payment keys, GOOGLE_CLIENT_ID)  then: systemctl restart yogesh-portfolio"
echo "  2) bash $APP/deploy/create-admin.sh \"Yogesh Singh\" admin@email.com 'strong-password'"
echo "  3) follow docs/GO_LIVE.md"
