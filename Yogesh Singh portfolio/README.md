# Yogesh Singh — portfolio, film platform & admin

A self-hosted replacement for the WordPress site: an animated portfolio, a film player with a **free first 30 minutes and a Cashfree paywall for the rest**, user login, and an admin panel for everything.

**Stack:** Node 22 (Express, built-in SQLite) · vanilla JS front end (no build step) · ffmpeg → HLS streaming · Cashfree Payments · Nginx + Let's Encrypt on a VPS.

## What's in it
| Area | Details |
|---|---|
| Homepage | Loader, animated hero, marquee, featured film, about + counters, pull-quote, journey list, speaking CTA, Instagram feed, footer. All text is edited in admin. |
| Film page `/film/<slug>` | HLS player. Anyone can watch the preview; when it ends a paywall appears. After payment it resumes at the same spot with the full film. Position is remembered. |
| Paywall security | The full playlist and every segment after the free window are refused by the server unless the signed-in user bought the film (or is admin). The price is read from the database, and payment is confirmed server-side with Cashfree (return page **and** signed webhook). |
| Accounts | Register / sign in (`/login.html`), "My films" (`/account.html`). bcrypt passwords, httpOnly session cookie, rate limiting, same-origin check. |
| Admin `/admin` | Dashboard & revenue · Films (upload or import from server, poster, trailer loop, price, free minutes, publish) · Orders · Users (grant free access, make admins) · Site content · Journey entries · Social feed (Instagram sync + manual posts) · Password. |
| Instagram | Paste a long-lived token once; posts/reels sync hourly, thumbnails are cached locally, the token auto-refreshes. Posts can be hidden or added by hand. |

## Run it locally
```bash
cd "Yogesh Singh portfolio"
npm install
npm run create-admin -- "Yogesh Singh" you@email.com 'a-strong-password'
npm run dev              # http://localhost:3000
```
Without Cashfree keys (and outside production) payments run in **demo mode**: the buy button completes instantly so you can test the whole flow. In production, missing keys disable checkout.
ffmpeg must be installed (`apt install ffmpeg` / `brew install ffmpeg`).

## Deploy on the VPS
1. Point the domain's A record to the VPS.
2. Copy this folder to the server: `rsync -av --exclude node_modules --exclude data "Yogesh Singh portfolio/" root@SERVER:/opt/yogesh-portfolio/`
3. `bash /opt/yogesh-portfolio/deploy/setup-vps.sh yourdomain.com you@email.com` installs Node, nginx, ffmpeg, HTTPS, the firewall and a systemd service.
4. Add the Cashfree keys to `/opt/yogesh-portfolio/.env`, create the admin and restart:
   ```bash
   cd /opt/yogesh-portfolio && sudo -u portfolio npm run create-admin -- "Yogesh Singh" admin@email.com 'strong-password'
   systemctl restart yogesh-portfolio
   ```
5. Sign in at `https://yourdomain.com/login.html`, then open **Admin**.

Recommended VPS: 2 vCPU / 4 GB RAM, 80 GB+ disk (a 2.5 h film is a few GB as source plus ~2–3 GB of streaming files) and generous bandwidth. Every viewer streams from this server; if traffic grows, put a CDN in front of `/media` or move segments to object storage.

## Cashfree setup
1. Create a Cashfree Payment Gateway account, complete KYC, and copy the **App ID** and **Secret Key** (start with the sandbox pair, `CASHFREE_ENV=sandbox`).
2. Put them in `.env` (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`).
3. In the Cashfree dashboard → Developers → Webhooks, add `https://yourdomain.com/api/payments/webhook`.
4. When ready, switch to `CASHFREE_ENV=production` with the live keys.

## Uploading the film
Admin → Films → *Manage*. Two options:
* **Upload** from the browser (fine for smaller files).
* **Recommended for a 2+ hour film:** `scp film.mp4 root@SERVER:/opt/yogesh-portfolio/data/incoming/`, then pick it under *Process*.

The server converts it to HLS (720p by default; `HLS_HEIGHT` / `HLS_CRF` in `.env`) with a progress bar. This is CPU-heavy and can take hours for 2.5 h of footage on a small VPS. The free minutes (default 30) can be changed any time without re-encoding.

## Instagram setup
Needs a Professional (Creator/Business) account. At developers.facebook.com create an app → add *Instagram* → *API setup with Instagram login* → generate a token. Paste it in Admin → Social feed → *Save*, then *Sync now*. Without a token you can still add posts manually.

## Backups
Everything lives in `data/` (SQLite database, uploads, encoded film). Back that folder up regularly.

## Limits worth knowing
* HLS gating stops casual sharing but is not DRM; a determined buyer can still screen-record. Use a DRM service if that matters.
* Single-rendition video (no adaptive bitrate) keeps the VPS workload simple.
* Homepage text is placeholder; replace it in Admin → Site content and Journey.
* Cashfree live checkout could not be tested from the build environment (sandbox keys needed); the flow was verified in demo mode and the code follows Cashfree's v3 API.
