# Y. P. Singh: portfolio, film platform and admin

Self-hosted website for Yogesh Pratap Singh (former IPS officer, author, film director, speaker): animated portfolio, film library, a player with a **free first 30 minutes and a one-time paywall for the rest**, Google + email sign-in, and an admin panel.

**Stack:** Node 22 (Express 4, built-in SQLite) · vanilla JS front end (no build step) · FFmpeg → HLS · Razorpay (or Cashfree) · nginx + Let's Encrypt on a Hostinger KVM VPS.

## Pages and how content gets onto them
| Page | What it shows | Where the owner edits it |
|---|---|---|
| `/` Home | Hero, featured film, short story, journey, Instagram teaser | Admin → Site content / Journey |
| `/films` and `/film/<name>` | Film library, free preview, payment | Admin → Films |
| `/about` | Biography, stats, timeline, speaking invitation | Admin → Site content (About, Stats) and Journey |
| `/contact` | Contact details + message form (spam-protected) | Details: Admin → Site content. **Messages arrive in Admin → Inbox** (with an unread count); reply with the "Reply by email" button |
| `/gallery` | Photograph gallery with a full-screen viewer; the portrait on About | **Admin → Photos** (photos are resized, converted to WebP and stripped of location data automatically) |
| `/privacy`, `/terms`, `/refunds` | Legal pages; checkout needs the buyer to tick agreement | **Admin → Legal pages** (starting templates with [placeholders]: fill in and have a lawyer review) |
| `/social` | Instagram posts and reels exactly as on Instagram | **Admin → Social feed → paste the post/reel link → "Add to website"** (no token needed). The site fetches the cover and caption and shows a designed card grid with Reels/Posts filters; clicking a card plays the post in a viewer. If Instagram withholds a cover, upload one (Upload cover) and edit the caption. Optional: connect an Instagram token for hands-free sync |

Notes: messages are always kept in the Inbox (unread badge). If email is set up (docs/EMAIL.md) you are also emailed each message; without it nothing is sent. Playing a post uses Instagram's own embed (needs the visitor's browser to reach instagram.com; public accounts only). Cover images and captions are read from Instagram's public preview data when a link is added; that can fail (Instagram sometimes asks for a login), which is why the admin can upload a cover. The embed playing was confirmed on a real account by the site owner; the automatic cover fetch has not been confirmed against live Instagram.

## What else the site does
* **Hindi / English** toggle (button in the menu). Interface text is translated from a built-in dictionary; the biography, film text and journey have their own Hindi boxes in Admin. The Hindi was written by an AI and needs a native speaker's read-through.
* **Film page:** cast and crew, subtitles (an uploaded .srt/.vtt; people who have not paid only get the free-preview part), and "continue watching" that follows the account to any device.
* **Admin:** Insight (anonymous funnel from visit to purchase), Discounts (codes, price decided on the server, never below ₹1), Activity log (who changed what), a System health panel on the Dashboard, optional two-step sign-in (authenticator app + recovery codes; `ADMIN_2FA_REQUIRED=true` makes it compulsory for admins).
* **Operations:** nightly backup with an off-server copy and status, disk and site-down alerts to a webhook or email, gzip and caching in nginx, `npm run measure-pages`.

## Documentation
| Guide | |
|---|---|
| [docs/AUDIT.md](docs/AUDIT.md) | Findings from the code audit, severity, fixes, decisions |
| [docs/CHANGES.md](docs/CHANGES.md) | What changed, files, migrations, test results, known limits |
| [docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md) | Google Cloud setup, account-linking rules |
| [docs/PAYMENTS.md](docs/PAYMENTS.md) | Razorpay/Cashfree test and production setup, webhooks, refunds |
| [docs/VIDEO.md](docs/VIDEO.md) | Uploading a 10.8 GB film, FFmpeg/HLS, publishing, capacity |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | VPS sizing, install, backups, restore, update, rollback |
| [docs/EMAIL.md](docs/EMAIL.md) | Optional email: contact alerts, receipts, forgot-password |
| [docs/GO_LIVE.md](docs/GO_LIVE.md) | Launch checklist |
| [docs/SECURITY.md](docs/SECURITY.md) | Access policy, what is enforced, honest limitations (no DRM, etc.) |

## Run locally
```bash
npm install
cp .env.example .env            # for local use set NODE_ENV=development and DATA_DIR=./data; leave payment keys empty for demo mode
npm run create-admin -- "Yogesh Singh" you@email.com 'a-long-strong-password'
npm run dev                     # http://localhost:3000   (needs ffmpeg + ffprobe on PATH)
```
Without payment keys (and outside production) checkout runs in clearly labelled **demo mode**. In production, missing keys disable checkout.

## Test
```bash
npm test          # 203 automated tests (needs ffmpeg), about 2 minutes, uses temp directories and simulated gateways. No real charges
npm run check     # syntax check of every source file
npm run verify-data   # payments, refunds and entitlements agree (read-only; run it on the server too)
```
There is no linter, type checker or build step in this project (plain JavaScript, no bundler). An optional browser smoke test is in `tests/e2e/smoke.cjs` (see the header of that file).

## Layout
```
server/            app.js (wiring, CSP), auth.js, google.js, config.js, db.js (versioned migrations)
server/payments/   ledger.js (all order/purchase state), razorpay.js, cashfree.js
server/routes/     auth, public, media (HLS gate), payments, admin, uploads (resumable)
server/transcode.js, hls.js, storage.js   ffmpeg jobs + validation, preview boundary, disk accounting
public/            site pages, js/, css/, admin/
deploy/            nginx, systemd, setup, backup, disk check, create-admin
scripts/           backup-db, verify-data, measure-encode, measure-upload, load-viewers
tests/             node:test suites
```
