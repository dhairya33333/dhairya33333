# Codebase audit

Audit of the existing code before this round of changes. Statuses are updated at the bottom once fixes are verified by the automated tests (`npm test`).

## What exists (verified by reading the code)

| Area | State before this round |
|---|---|
| Stack | Node 22, Express 4, built-in `node:sqlite` (**SQLite, not PostgreSQL**), vanilla JS front end, ffmpeg → HLS |
| Payments | **Cashfree** only (v3 API, `server/cashfree.js`). No Razorpay code. Demo mode outside production |
| Auth | Email/password (bcrypt), JWT in httpOnly cookie, `role` column. **No Google sign-in** |
| Streaming | Single 720p HLS rendition; gating in `routes/media.js` (full playlist + segments after the free window need a purchase row) |
| Uploads | Browser multipart POST (multer → disk) and "import from incoming folder" |
| Tests / lint / types / build | **None existed.** Only `node --check` could be run (passed). `npm audit`: 0 vulnerabilities |

## Findings

| # | Sev | Finding | Files | Fix |
|---|---|---|---|---|
| 1 | High | Deleting a film in admin also deletes the **original source file** (`fs.rm(m.source_file)`) with no approval step | `routes/admin.js` | Never delete originals on film delete. Separate, explicit "approve source cleanup" action, allowed only after validated output |
| 2 | High | Admin `GET /movies` is `SELECT *`, so it returns `source_file` (absolute server path); `GET /incoming` returns the server's incoming directory | `routes/admin.js` | Strip private fields; show relative info only |
| 3 | High | No upload size limit, no disk-space check, one 10 GB multipart POST is fragile; partial uploads are written straight into the final source directory and never cleaned up | `routes/admin.js`, `config.js` | Resumable chunked upload into a temp area, size cap, free-space check, upload status table, stale-partial cleanup |
| 4 | High | Encoded output is trusted when ffmpeg exits 0: no playlist/segment validation before publishing; a failed **re-process** wipes the live output first (movie goes offline) | `transcode.js` | Encode to a temp dir, validate, then atomically swap. Failure leaves the live stream and the original untouched |
| 5 | High | Refunds, cancellations and duplicate webhooks are not handled; no webhook event idempotency table; webhook amount not compared with the order; a user clicking "buy" repeatedly creates many orders | `routes/payments.js`, `db.js` | Payment ledger module, `payment_events` table, amount/currency check, order reuse, refund revokes access |
| 6 | Med | Free-preview boundary can overshoot by up to one segment (<6 s): a segment is included while its *start* is before the limit | `hls.js` | Include only segments that *end* at or before the limit |
| 7 | Med | Password change does not end existing sessions; admin password change does not require the current password; passwords longer than 72 bytes are silently truncated by bcrypt | `auth.js`, `routes/admin.js`, `routes/auth.js` | `token_version` in the session JWT, current-password check, length cap |
| 8 | Med | Admin film update uses manual `BEGIN/COMMIT` (a throw leaves a transaction open) | `routes/admin.js` | `tx()` helper |
| 9 | Med | Social links saved as-is and rendered into `href`: a `javascript:` URL would execute (admin-only vector) | `routes/admin.js` | Accept http(s) URLs only |
| 10 | Med | No rate limit on checkout/payment endpoints | `routes/payments.js` | Rate limiters |
| 11 | Med | CSP does not allow Google or Razorpay scripts/frames | `index.js` | Add only the required origins, and only when the integration is configured |
| 12 | Med | Only one ffmpeg job at a time by construction, but no configurable cap, no `nice`, no free-space check before encoding | `transcode.js` | `ENCODE_CONCURRENCY`, `nice`, preflight disk estimate |
| 13 | Low | Missing portfolio items from the brief: films library page and an articles section | `public/` | `films.html`, articles entries |
| 14 | Low | No automated tests, no CI-style check script | repo | `node:test` suite, `npm test`, `npm run check` |

## Decisions that differ from the brief (and why)

* **Database stays SQLite.** The brief mentions PostgreSQL, but the app is built on SQLite (WAL). For a single small VPS this is reliable and simpler to back up, and a migration would be a large, risky change that "preserve the existing architecture" argues against. Schema changes are additive and versioned (`PRAGMA user_version`). Moving to PostgreSQL is possible later but is **not done**.
* **Payments: Razorpay added, Cashfree kept.** The original quotation names Razorpay; the code used Cashfree. Both are implemented completely behind one provider interface (`PAYMENT_PROVIDER=razorpay|cashfree`, default `razorpay`), sharing one ledger, so there is no half-finished duplicate. Remove the one the client does not use if preferred.
* **Playback authorization uses the session cookie plus a database entitlement check on every playlist and segment request**, instead of expiring signed URLs. Reason: a 2.5 h film outlives any short-lived URL (it would need a refresh protocol), Safari's native HLS cannot rewrite segment URLs, and a per-request check revokes access immediately on refund. Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## Status after this round

| # | Status | Verified by |
|---|---|---|
| 1 | Fixed | `uploads.test.js` "original is only removed by an explicit, confirmed action…" |
| 2 | Fixed | `uploads.test.js` "admin API never returns server paths or private fields" |
| 3 | Fixed (size cap, disk check, resumable chunks, cleanup) | `uploads.test.js` init/chunk/stale tests; browser smoke test. A real 10.8 GB run is **not** done |
| 4 | Fixed | `uploads.test.js` failed-encode and validation tests |
| 5 | Fixed (Razorpay; Cashfree refunds not auto-revoked) | `payments.test.js` |
| 6 | Fixed | `streaming.test.js` boundary tests |
| 7 | Fixed | `auth.test.js` |
| 8 | Fixed | code review (uses `tx()`) |
| 9 | Fixed | code review; admin-only vector |
| 10 | Fixed | `ratelimit.test.js` covers auth/Google; payment limits by code review |
| 11 | Fixed | `google.test.js` CSP test; payment CSP by code review |
| 12 | Fixed | `uploads.test.js` concurrency test |
| 13 | Fixed | browser smoke test |
| 14 | Fixed | 72 tests, `npm test` |

Full results and remaining limitations: `docs/CHANGES.md`.


---

# Second audit round (hardening against the production-readiness brief)

Baseline before this round: clean `npm ci` from the lockfile succeeded, `npm run check` passed, **72/72 tests passed**, `npm audit --omit=dev` 0 vulnerabilities (Node 22.22, 4 vCPU, 16 GB, FFmpeg 6.1). Git checkpoint: tag `checkpoint-before-hardening-2`.

| # | Priority | Sev | Finding | Fix | Verified by |
|---|---|---|---|---|---|
| R1 | Payments | High | If a webhook omitted amount/currency the comparison was **skipped** (`!= null` guard) | Ledger rejects any missing/non-integer amount, currency or payment id; webhook fetches authoritative data from the gateway | `payments-hardening`, `cashfree` tests; mutation check |
| R2 | Payments | High | Cashfree path never passed the paid amount/currency/payment id to the ledger | Cashfree webhook and reconcile read `/orders/{id}/payments` (exact paise) | `cashfree.test.js` (10 tests) |
| R3 | Payments | High | Refund "full" decided from numbers inside the webhook payload; no running total; no refund-id idempotency | `refunds` table, total summed from records, judged against OUR stored price | `payments-hardening` |
| R4 | Payments | Med | No dispute handling, no explicit PENDING state, one gateway payment could be offered for several orders | Dispute states + admin revoke, `PENDING`, unique `(provider, provider_payment_id)` + ledger check | `payments-hardening`, `data-integrity` |
| R5 | Payments | Med | No transition logging; secrets could reach logs | Redacting structured logger; transitions logged by reference only | log test |
| R6 | Auth | Med | Logout only cleared the cookie (a copied token stayed valid up to 30 days) | Per-token id (`jti`) revocation list, 14-day sessions, HS256 only | `auth-hardening` |
| R7 | Auth | Med | No password recovery path at all | Admin-issued one-time hashed link (60 min, single use), ends other sessions | `auth-hardening` |
| R8 | Auth | Low | Malformed `GOOGLE_CLIENT_ID` or http `SITE_URL` in production accepted silently | Startup validation / hard stop | `auth-hardening` |
| R9 | App | Med | No global API rate limit | Per-IP `/api` limiter (media excluded) | `ratelimit-api` |
| R10 | Uploads | Med | No chunk integrity check; any admin could touch any upload; two writers could race on one upload | SHA-256 per chunk, owner binding, in-flight lock | `uploads-hardening` |
| R11 | Uploads | Med | Disk preflight used a typical bitrate, not the worst case | Worst case at the bitrate cap; documented calculation | `uploads-hardening`, VIDEO.md |
| R12 | FFmpeg | Med | No encode timeout, no cancel, no ffmpeg availability check, admin-visible errors could contain server paths, orphaned ffmpeg after a hard crash | Timeout, cancel (running/queued), `/healthz` + dashboard check, path scrubbing, orphan cleanup at start-up | `uploads-hardening`, `data-integrity` crash test |
| R13 | DB | Med | Files created with default permissions; no data-consistency tool; restore never drilled | umask 077 + explicit modes, `npm run verify-data`, restore drill and crash-recovery tests, extra indexes, `synchronous=NORMAL` | `data-integrity` |
| R14 | Preview | Med | Boundary verified only on tidy 6.000 s segments | Verified on a 23.976 fps encode: timestamps, continuity, A/V sync, decoding, seeking, strict prefix of the full film | `preview-media` |
| R15 | SEO | Low | No canonical URLs, sitemap, robots, structured data | Added (only from configured content, nothing invented) | `seo` |
| R16 | UX | **High on phones** | The paywall's "Unlock" button was **clipped out of view inside the small phone player** (found by looking at a screenshot; an earlier bounding-box check had missed it) | Compact paywall layout on small screens; the test now requires the button to lie inside the player | browser test |
| R17 | UX | Low | Payment dialog did not trap keyboard focus | Tab trap + Escape | browser test |
| R18 | Setup | Med | `umask 077` would have removed group access from the SFTP drop folder | Explicit `chmod 2770` for `incoming` | `data-integrity` |
