# Hostinger VPS deployment

## What to buy and what it needs
| Item | Requirement |
|---|---|
| Plan | Hostinger **KVM VPS**, 2 vCPU and 4 GB RAM minimum (more CPU = faster encoding). Check the current plan sizes on Hostinger |
| OS | Ubuntu 22.04 or 24.04 LTS (64-bit) |
| Disk | Original 10.8 GB + processed ~3–4 GB + working space (an upload needs the file size free again) + backups ⇒ **plan for ≥ 60 GB, 100 GB+ is comfortable**, and always keep an off-server copy of the original |
| Software | Node.js ≥ 22.13, FFmpeg/ffprobe, nginx, certbot (Let's Encrypt), ufw, fail2ban: all installed by `deploy/setup-vps.sh` |
| Database | **SQLite** (file in `DATA_DIR`, WAL mode). The brief mentions PostgreSQL, but this app was built on SQLite. For one small server it is simpler and just as safe with the backups below. There is no database port to expose. Moving to PostgreSQL later is a separate, larger task |
| Domain | Registered by the client; A record (and `www`) pointing to the VPS IP |

Client pays directly for the VPS, domain, any later CDN, payment-gateway fees and paid services.

## Layout (separate directories, ready for separate volumes)
```
/opt/yogesh-portfolio        application code (root-owned, read-only to the service)
/etc/yogesh-portfolio/env    secrets, mode 600
/var/lib/yogesh-portfolio    database (portfolio.sqlite), public uploads
/srv/yp/originals            ORIGINAL films
/srv/yp/incoming             SFTP drop folder
/srv/yp/hls                  processed streaming files (rebuildable from originals)
/srv/yp/tmp                  partial uploads
/srv/yp/backups              nightly database copies
```
Nothing under `/srv/yp` is reachable from nginx; nginx proxies only to the app, and the app only serves processed films through the entitlement check.

## First deployment
```bash
# on your computer
rsync -av --exclude node_modules --exclude data --exclude .env "Yogesh Singh portfolio/" root@SERVER:/opt/yogesh-portfolio/
# on the server, as root
bash /opt/yogesh-portfolio/deploy/setup-vps.sh yourdomain.com you@email.com
nano /etc/yogesh-portfolio/env                    # payment keys, GOOGLE_CLIENT_ID, BACKUP_REMOTE (optional)
systemctl restart yogesh-portfolio
bash /opt/yogesh-portfolio/deploy/create-admin.sh "Yogesh Singh" admin@email.com 'a-long-strong-password'
```
`setup-vps.sh` configures: nginx (64 MB body cap because uploads are 32 MB pieces, 10-min timeouts, rate limit on login, dotfiles blocked), HTTPS with auto-renewal, the systemd service (auto-restart, hardening), journald size cap, ufw (SSH + HTTPS only), fail2ban, nightly backup and disk-check cron jobs.

Large-request note: the default nginx/Node limits would reject a 10.8 GB POST; that is why the uploader sends pieces. The app also sets Node's request timeout to unlimited for those requests. Verified in code and tests; **the nginx and systemd files themselves could not be executed in the build environment**, so check `nginx -t`, `systemctl status yogesh-portfolio` and `journalctl -u yogesh-portfolio -n 50` after install.

## Day-to-day operations
| Task | Command |
|---|---|
| Status / restart | `systemctl status yogesh-portfolio` / `systemctl restart yogesh-portfolio` |
| App logs | `journalctl -u yogesh-portfolio -f` (capped at 500 MB / 30 days). Logs never contain passwords, tokens or payment payloads |
| nginx logs | `/var/log/nginx/` (rotated by the system's logrotate) |
| Disk | Admin → Dashboard, or `df -h /srv/yp /var/lib/yogesh-portfolio`. `check-disk.sh` logs a critical line above 85% (set `ALERT_EMAIL` to be mailed) |
| Update the site | see *Updating* |
| Renew HTTPS | automatic (`certbot.timer`); test with `certbot renew --dry-run` |

## Backups
1. **Database** (users, purchases, orders, content): `deploy/backup.sh` runs nightly at 03:15, writes a consistent copy with `VACUUM INTO` to `/srv/yp/backups`, verifies it with `PRAGMA quick_check`, keeps 14.
2. **Off-server copy (required):** set `BACKUP_REMOTE=user@backup-host:/backups/yp` in the env file (rsync over SSH, key-based). This also copies **originals** and uploaded images. Any second machine works (your own computer, another cheap server, a cloud bucket via rclone). The client pays for it.
3. **A VPS snapshot is not enough**: it lives with the same provider/account and may be lost with the server.
4. The processed HLS can always be rebuilt from the original, so it is the lowest-priority backup.

### Restore
```bash
systemctl stop yogesh-portfolio
cp /srv/yp/backups/portfolio-YYYYMMDD-HHMMSS.sqlite /var/lib/yogesh-portfolio/portfolio.sqlite
rm -f /var/lib/yogesh-portfolio/portfolio.sqlite-wal /var/lib/yogesh-portfolio/portfolio.sqlite-shm
chown portfolio:portfolio /var/lib/yogesh-portfolio/portfolio.sqlite
systemctl start yogesh-portfolio
```
Lost server entirely: new VPS → `setup-vps.sh` → restore the database file and `uploads/` → copy originals back to `/srv/yp/originals` → press *Re-process* on each film (or copy `/srv/yp/hls` too). Practise this once before launch.

## Updating and rollback
```bash
# before: take a database backup
sudo -u portfolio /opt/yogesh-portfolio/deploy/backup.sh
cp -a /opt/yogesh-portfolio /opt/yogesh-portfolio.prev            # keep the previous release
rsync -av --delete --exclude node_modules --exclude data --exclude .env NEW/ /opt/yogesh-portfolio/
cd /opt/yogesh-portfolio && npm ci --omit=dev && systemctl restart yogesh-portfolio
```
Database migrations are additive only (new columns/tables, tracked in `PRAGMA user_version`), so the previous code still runs on a migrated database.
**Rollback:** `systemctl stop yogesh-portfolio; rsync -av --delete /opt/yogesh-portfolio.prev/ /opt/yogesh-portfolio/; systemctl start yogesh-portfolio`. Restore the pre-update database backup only if data was damaged.

## Security checklist for the server
Only ports 22, 80 and 443 open; SSH keys only (`PasswordAuthentication no` once your key works); `unattended-upgrades` enabled; env file mode 600; `JWT_SECRET` unique and 32+ chars (the app refuses to start in production otherwise); never run the app as root.
