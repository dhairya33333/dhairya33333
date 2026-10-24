# Changes in this round

Incremental changes to the existing codebase (no rewrite). Audit findings are in [AUDIT.md](AUDIT.md).

## Summary
1. **Google sign-in** added next to email/password, same session cookie, verified server-side, takeover-safe linking.
2. **Payments**: Razorpay implemented as the default provider; Cashfree kept behind the same interface. One ledger enforces idempotency, amount/currency checks, refunds, cancellations and persistence.
3. **30-minute preview**: strict boundary (segments must *end* by the limit), server-side gating of every playlist/segment on every request, a `/playback` endpoint that decides what the player may load, clearer player states.
4. **Uploads**: resumable 32 MB-chunk upload (memory stays flat), 16 GB default cap (10.8 GB fits), disk-space checks, per-upload status, stale-partial cleanup, safe import from an incoming folder, no private paths exposed.
5. **FFmpeg/HLS**: job queue with a concurrency cap and `nice`, encode to a temp directory, **validation before publish**, atomic swap, failures never touch originals or the live film, audio-sync flags, bitrate cap, size/time estimate, real timings recorded.
6. **Originals are protected**: deleting a film no longer deletes the original; removal is a separate, typed-confirmation action allowed only after validation.
7. **Security**: sessions revoked on password change, current password required, 72-byte password limit, social/article links restricted to http(s), CSP only allows third parties that are configured, rate limits on auth and payments, malformed bodies not logged, admin API stripped of server paths.
8. **Portfolio**: Films library page, articles section, preview explanation, payment-pending/failed/refunded screens, accessibility fixes (live regions, dialog roles, Escape to close, focus handling).
9. **Operations**: versioned additive migrations, DB backup script (+ restore test), nginx/systemd/cron/log-rotation files, disk check, off-server backup hook, docs.
10. **Tests**: 72 automated tests (previously none).

## Bugs found and fixed while verifying
* Admin-created films defaulted to ₹1 when the price was left blank, and fractional free-minutes (e.g. 0.2) were rounded to 0 when the form was re-saved. Both fixed with regression tests.
* Year counters displayed "1,985"; fixed earlier in the white-theme round.

## Files
**New:** `server/app.js`, `server/google.js`, `server/storage.js`, `server/payments/{ledger,razorpay}.js`, `server/routes/uploads.js`, `scripts/backup-db.js`, `public/films.html`, `public/js/{films,google}.js`, `deploy/{backup.sh,check-disk.sh,create-admin.sh,journald-yp.conf}`, `docs/*`, `tests/*` (7 suites, helpers, `e2e/smoke.cjs`)
**Moved:** `server/cashfree.js` → `server/payments/cashfree.js` (now also implements the provider interface)
**Modified:** `server/{auth,config,db,hls,index,transcode}.js`, `server/routes/{admin,auth,media,payments,public}.js`, `public/{index,film,login,account,payment-return}.html`, `public/js/{common,film,home,login,account,payment-return}.js`, `public/admin/{admin.js,admin.css}`, `deploy/{nginx.conf,setup-vps.sh,yogesh-portfolio.service}`, `.env.example`, `README.md`, `package.json` (+ `google-auth-library`)
**New dependency:** `google-auth-library` (Google's maintained, free, open-source library). No other dependencies were added; Razorpay is called with `fetch`.

## Database migrations
Applied automatically at start-up, additive only, tracked with `PRAGMA user_version` (now 2). Existing data is preserved (verified by booting the new code against the previous database).
* `users`: `google_sub` (unique when set), `email_verified`, `token_version`
* `orders`: `provider`, `provider_order_id`, `provider_payment_id`, `currency`, `failure_reason`, `refunded_at`, `updated_at` (+ unique index)
* new `payment_events` (webhook idempotency), new `uploads` (per-upload status)
* `movies`: `encode_state`, `validated`, `encode_seconds`, `source_bytes`, `output_bytes`, `segments` (films that were already `ready` are marked `validated`)
* `works`: `url`
To roll back the code, the old version still runs on the migrated database.

## Test results (run on this build, Node 22.22, ffmpeg present)
```
npm run check   -> syntax OK
npm test        -> 72 tests, 72 pass, 0 fail, ~42 s
npm audit --omit=dev -> 0 vulnerabilities
```
| Suite | Tests | Covers |
|---|---|---|
| auth | 10 | register/login/logout, validation, generic errors, bcrypt, admin 401/403/200, session revocation, cross-origin block, cookie flags, no stack traces, no password in logs |
| google | 11 | real library verification against locally signed tokens: valid, wrong audience/issuer/signature/expiry/kid, unverified email, `alg=none`/HS256 forgeries; account creation, no duplicates, takeover protection, linking rules, admin protection, config, CSP |
| payments | 18 | server price, signature checks, authorized-only/underpayment, IDOR, webhook signature, duplicate delivery, mismatch, failed, refunds, cancel + late payment, reconcile, persistence, demo disabled |
| streaming | 11 | real ffmpeg encode (H.264/AAC, in-sync, no upscale), preview boundary and no-overshoot, anonymous/unpaid/paid/admin access to every segment, traversal and odd names, playback endpoint, unpublished, **payment → playback → refund → locked**, IDOR |
| uploads | 19 | admin-only, type/size/disk checks, hostile filenames, chunk order/resume/overflow, cancel, stale cleanup, non-video files, import traversal and symlinks, failed encode keeps original and live film, first-encode failure, output validation, concurrency cap, no path leakage, original-removal rules, paying-customer protection, storage report, restart recovery, defaults |
| ratelimit | 2 | login and Google endpoint limits |
| backup | 1 | consistent restorable DB copy, retention |

Also: tests were confirmed to fail when the protection is removed (disabling the entitlement check broke 5 streaming tests; disabling signature verification broke the payment test). A real-browser run (`tests/e2e/smoke.cjs`, Playwright/Chromium) passed: Google button error path (Google's script stubbed), admin chunked upload + encode through the UI, library page, free preview with paywall at the boundary, sign-up, demo purchase, full playback.

## Not done, not verified, or different from the brief
* **PostgreSQL**: not used; the app stays on SQLite (reasons in AUDIT.md). Backups are provided.
* **Real gateway and Google traffic were never exercised.** Razorpay/Google calls are faked or use locally signed tokens. Needs the client's test credentials: follow `docs/PAYMENTS.md` and `docs/GOOGLE_OAUTH.md`, tick the money items in `GO_LIVE.md`.
* **nginx, systemd, certbot, ufw, cron and the setup script were not executed** (no such environment here); only shell syntax was checked.
* **No load test**: concurrent-viewer capacity is unknown. See the formula in `docs/VIDEO.md`.
* **10.8 GB end-to-end run not performed**; chunking, limits and disk logic are tested with small files, and encode speed for a real 2.5 h source is an estimate until measured.
* No adaptive bitrate (single 720p rendition), no DRM (a buyer can still screen-record), no email verification for password accounts, no password-reset email flow (needs an email service; ask the admin to reset or add later), partial refunds do not revoke access, Cashfree refunds are not auto-revoked.
* Playback authorization is cookie + per-request database check rather than expiring signed URLs (rationale in AUDIT.md).
* The site's biography/awards text still comes from public search snippets, not from ypsingh.com (unreachable from the build environment): must be verified by the client.
