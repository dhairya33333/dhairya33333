#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04/24.04 VPS. Run as root:  bash setup-vps.sh example.com you@email.com
# Copy the project folder to /opt/yogesh-portfolio BEFORE running this.
set -euo pipefail
DOMAIN="${1:?domain, e.g. example.com}"; EMAIL="${2:?email for HTTPS certificate}"
APP=/opt/yogesh-portfolio

apt-get update
apt-get install -y nginx ffmpeg certbot python3-certbot-nginx curl ca-certificates ufw openssl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

id portfolio &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin portfolio
cd "$APP"
npm ci --omit=dev
[ -f .env ] || { cp .env.example .env; sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|; s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|" .env; }
chown -R portfolio:portfolio "$APP"

cp deploy/yogesh-portfolio.service /etc/systemd/system/
sed "s/example.com/$DOMAIN/g" deploy/nginx.conf > /etc/nginx/sites-available/yogesh-portfolio
ln -sf /etc/nginx/sites-available/yogesh-portfolio /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

systemctl daemon-reload && systemctl enable --now yogesh-portfolio
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
echo
echo "Next: add the Cashfree keys to $APP/.env, then:"
echo "  cd $APP && sudo -u portfolio npm run create-admin -- \"Yogesh Singh\" admin@email.com 'strong-password'"
echo "  systemctl restart yogesh-portfolio"
