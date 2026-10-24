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
