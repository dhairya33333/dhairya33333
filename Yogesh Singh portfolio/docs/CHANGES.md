# Change report

Incremental changes to the existing codebase (no rewrite). Findings and fixes: [AUDIT.md](AUDIT.md). Security model and limits: [SECURITY.md](SECURITY.md).
Round 1 added Google sign-in, Razorpay, resumable uploads and the validated HLS pipeline. **Round 2 (this report's focus) hardened payments, authentication, media access, uploads, data integrity, SEO and deployment, and measured performance.**

## 0. Latest addition: About, Contact and Social pages
* **New pages** `/about`, `/contact`, `/social` with a shared header/footer, page-reveal animations, staggered cards, an animated timeline and counters. Navigation on every page now reads Films · About · Social · Contact.
* **Contact form** (`POST /api/contact`): validated, spam-protected (honeypot, 5/hour/IP, link limit), stored in a new `messages` table (migration 4). **Admin → Inbox** lists messages with an unread badge, mark read/unread, delete, and a "Reply by email" button. No email is sent automatically (no email service configured).
* **Social page**: the admin pastes Instagram post/reel links (Admin → Social feed); they are shown through Instagram's official embed. Optional token sync still works. Links are strictly validated; only the short code reaches the browser; CSP allows `https://www.instagram.com` as a frame only.
* **12 new tests** (`tests/pages.test.js`): pages, canonicals, sitemap, form validation/limits/honeypot/rate limit, inbox permissions, Instagram link parsing (look-alike hosts, credentials, ports, scripts), embed API, CSP. Browser check `tests/e2e/pages.cjs`: all three pages and the admin screens render, no horizontal scrolling on desktop or phone, no JS errors.
* **Not verified:** the Instagram embeds were checked with a local stand-in, not the live Instagram (no internet access in the build environment). Test with real links on the staging site.
* Test count is now **146 (all pass)**.

## 1. Summary of round-2 audit findings
18 findings, 8 of them High or Medium-High: the main ones were a payment comparison that was silently **skipped** when a webhook omitted a field, a Cashfree path that never supplied the paid amount to the ledger, refund "full" judged from webhook numbers, logout not revoking the session token, no password recovery, and a **paywall button clipped out of view on phones**. Full table: `AUDIT.md` (R1 to R18).

## 2. Payment provider selected
**Razorpay is the primary provider for launch** (`PAYMENT_PROVIDER=razorpay`, the default): the original quotation names it. **Cashfree is retained** only because the project owner originally named it and it was already built; it is now held to the same standard (authoritative amounts, refunds, idempotency) and has its own test suite. There is no documented client need for it, so delete `server/payments/cashfree.js` and the cashfree lines in `routes/payments.js` if it will never be used.
Configuration needed (placeholders in `.env.example`): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; webhook `https://DOMAIN/api/payments/webhook` with events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `payment.dispute.created`, `payment.dispute.lost` (and `.won`/`.closed`). Details and the refund/dispute policy: `PAYMENTS.md`.

**Refund policy (defined, changeable in one place: `server/payments/ledger.js`):** refunds are summed; total ≥ price → access revoked; **partial refund → access kept**; open dispute → kept and flagged; lost dispute or admin revoke → revoked.

## 3. Changed files and why (round 2)
| File | Why |
|---|---|
| `server/payments/ledger.js` | One transactional place for all order states; strict verified-field rules; refund records; disputes; transition logging |
| `server/payments/razorpay.js`, `cashfree.js` | Authoritative payment/refund lookups; richer webhook parsing (refunds, disputes); exact paise handling |
| `server/routes/payments.js` | Webhook applies events through the ledger; unconfirmed "captured" claims are not recorded so they can be redelivered; explicit PENDING; client statuses |
| `server/log.js` (new) | Structured logger that redacts secrets/tokens/signatures and scrubs filesystem paths |
| `server/auth.js`, `routes/auth.js` | Token-id revocation on logout, HS256 only, 14-day sessions, one-time password reset |
| `server/config.js` | Fails fast on non-https `SITE_URL` or weak `JWT_SECRET` in production, validates Google client id, umask 077, directory modes, new limits |
| `server/db.js` | Migration 3 (refunds, disputes, unique payment ids, revoked tokens, password resets, upload owner, indexes), `synchronous=NORMAL`, file modes |
| `server/app.js` | Global API limit, `/healthz`, robots.txt, sitemap.xml, canonical/OG/JSON-LD, ffmpeg start-up check |
| `server/routes/uploads.js` | Per-chunk SHA-256, owner binding, single writer per upload, scrubbed errors |
| `server/transcode.js`, `storage.js` | Timeout, cancel, ffmpeg check, worst-case disk preflight, path scrubbing, orphaned-ffmpeg cleanup, exported arg builder |
| `server/routes/admin.js` | Order revoke, password reset links, cancel encode, ffmpeg status |
| `scripts/verify-data.js`, `measure-encode.js`, `measure-upload.js`, `load-viewers.js` (new) | Data consistency check and the three measurement tools |
| `public/film.html`, `js/film.js`, `admin/*`, `reset-password.*`, `login.html`, `account.html`, `payment-return.*` | Phone paywall fix, runtime/year facts, focus trap, checksum upload, cancel/revoke/reset controls, noindex, new screens |
| `deploy/*`, `.env.example` | UMask, memory cap, group-writable drop folder, new variables |
| `docs/*`, `README.md` | Security model, measured results, backup/restore, checklists |
| `tests/*` (9 new files, helpers, e2e) | 62 new automated tests plus a browser smoke test |

## 4. Commands run and actual results
| Command | Result |
|---|---|
| `npm ci` in a clean copy of the repository | success in 4 s, lockfile honoured |
| `npm run check` (syntax of every source file) | **OK** |
| `npm test` (before round 2) | 72 tests, 72 pass |
| `npm test` (after round 2) | **134 tests, 134 pass, 0 fail, 0 skipped, 117 s** |
| `npm audit --omit=dev` | 0 vulnerabilities (run at the start; no dependency was added in round 2) |
| `node tests/e2e/smoke.cjs` (Chromium, Playwright, desktop + Pixel 7 emulation) | all checks PASS, no JS errors |
| `node scripts/measure-encode.js` | see `VIDEO.md`: 3.26× real time on 4 vCPU, 255 MB peak, output 38% of source |
| `SIZE_GB=10.8 node scripts/measure-upload.js` | 10.8 GB in 174 s, memory flat 113 to 118 MB |
| `node scripts/load-viewers.js … 10,50,100,200,400,800` | 0 errors to 800 virtual viewers on loopback; see `VIDEO.md` for latency and the saturation point |
There is **no linter, type checker or build step** in this project (plain JavaScript, no bundler), so none could be run. Tests were also shown to **fail when protections are removed** (mutation checks): disabling the entitlement check (5 failures), signature check (1), amount comparison (4), the full-refund rule (1) and logout revocation (1).

## 5. Test results
134 automated tests in 15 files: `auth` 10, `auth-hardening` 7, `google` 11, `payments` 18, `payments-hardening` 13, `cashfree` 10, `ratelimit` 2, `ratelimit-api` 1, `streaming` 11, `preview-media` 7, `uploads` 19, `uploads-hardening` 11, `data-integrity` 7, `backup` 1, `seo` 6. **Failures: none. Skipped: none** (the ffmpeg-dependent tests would skip on a machine without ffmpeg).
Failures I hit and fixed while building them (all were defects in my test or my new code, none were weakened away): a rate limiter tripping the tests (made configurable), duplicate test payment ids correctly refused by the new one-payment-per-order guard, a stale keep-alive connection in the test client, a clipped phone paywall button, a bounding-box check that gave a false pass.

## 6. Status of each requirement: IMPLEMENTED / TESTED / NOT VERIFIED
| Area | Implemented | Tested here | NOT VERIFIED / BLOCKED (next action) |
|---|---|---|---|
| Server-side order creation with authoritative price, bound to user/movie/INR | yes | yes (both gateways) | |
| Razorpay signature, webhook signature on raw bytes, amount/currency comparison, idempotency, refunds, disputes | yes | yes, with a simulated Razorpay API | **No real Razorpay test-mode transaction was run** (needs your keys): follow `PAYMENTS.md`. Webhook field names follow the documentation as understood; confirm in test mode |
| Cashfree equivalent | yes | yes, simulated API | Same: needs sandbox credentials |
| Partial refund, full refund, dispute policy | yes (defined above) | yes | Client to confirm the partial-refund policy |
| Google sign-in, linking rules | yes | yes: real library verification with locally signed tokens, all rejection paths | **A live sign-in with a real Google account was not run** (needs your Client ID and a published consent screen) |
| Sessions, logout revocation, expiry, rate limits, admin protection, no CORS | yes | yes | |
| Password recovery | admin-issued one-time link (no email service) | yes | Self-service email reset is **not** built (needs an email provider: optional enhancement) |
| 30-minute preview (media time), server-enforced gate, no paid segment reachable | yes | yes, on real encoded media incl. 23.976 fps, seeking, sync, decode, IDOR, refunded/expired/anonymous | Real iPhone/Safari **not tested** (only Chromium and Pixel-7 emulation) |
| Large upload (chunked, resumable, checksums, owner, disk checks, cleanup) | yes | yes; **10.8 GB dummy upload through the real API, memory flat** | Not tested through nginx, a real browser or a real internet link; real 10.8 GB *video* not available |
| FFmpeg 720p HLS, validation, atomic publish, timeout, cancel, concurrency cap | yes | yes (small and 5-minute 1080p sources) | The real film's encode time and visual quality: run `measure-encode.js` on the VPS and watch the result |
| SQLite integrity, constraints, WAL, permissions, backup, **restore drill**, crash recovery | yes | yes (restore into a fresh server; SIGKILL mid-encode) | A real reboot and restore on the VPS are yours to run |
| Deployment files (nginx, systemd, setup script, cron, logrotate) | yes | **shell syntax only** | **Not executed anywhere** (no nginx/systemd here). `nginx -t`, service start, HTTPS issuance, reboot recovery: run on staging first |
| SEO (canonical, OG, JSON-LD, sitemap, robots, noindex) | yes | yes | Check with Google's Rich Results test after launch |
| Concurrent-viewer capacity | measured (server side, loopback) | yes | **Internet capacity unknown**: needs a real multi-network test; no viewer count is promised |
| DRM, adaptive bitrate, CDN | **no** (out of scope) | n/a | optional, see below |

## 7. Unresolved issues and deployment blockers
**Blockers before taking real money**
1. Razorpay account activation/KYC and a successful **test-mode purchase + refund** on staging (owner: client + developer).
2. Google Cloud OAuth client created and a live sign-in confirmed (owner: client).
3. Staging deployment run of `setup-vps.sh` and the whole `GO_LIVE.md` checklist, including an off-server backup of the original film and a restore drill (owner: developer).
4. Real iPhone Safari and Android phone playback check.
5. Real biography/awards/credits supplied or verified by the client (the site text is from public search snippets only).

**Known limitations (not defects)**: no DRM (a buyer can record or capture the stream); no concurrent-stream limit; email addresses of password accounts are unverified; partial refunds keep access; open disputes keep access; single-node SQLite; webhook formats validated against simulations, not live traffic; Node's built-in SQLite is flagged "experimental" by Node 22 (works; revisit on a Node upgrade).

## 8. Optional enhancements beyond the current ₹10,000 scope
Email-based password reset and email receipts (needs an email provider); 1080p + adaptive-bitrate renditions; CDN or object-storage delivery with signed URLs (extra monthly cost, changes the access design); DRM service; concurrent-stream limits; automated off-server backup to a cloud bucket; PostgreSQL migration only if measured load or operations ever require it; error monitoring/alerting service; admin audit log screen.

## 9. Database migrations
Applied automatically at start-up, additive only (`PRAGMA user_version` 1 → 3). Round 2 adds: `orders.refunded_paise`, `orders.dispute_status`, unique `(provider, provider_payment_id)`, tables `refunds`, `revoked_tokens`, `password_resets`, `uploads.created_by`, and indexes. Existing data is preserved (verified by booting new code on the previous database). The previous code still runs on a migrated database.
