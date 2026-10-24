# Security model, policies and known limitations

## Access policy (what is enforced where)
| Who | Free preview | Full film | Admin |
|---|---|---|---|
| Visitor, not signed in | **Yes**, no login needed (policy: the preview is public so anyone can sample the film) | No: `401` | No: `401` |
| Signed in, has not bought | Yes | No: `403` | No: `403` |
| Buyer (`PAID`, `PARTIALLY_REFUNDED`) | Yes | Yes | No |
| Refunded in full / charged back | Yes | **No, from the next request** | No |
| Admin | Yes | Yes (to review films) | Yes |
| Expired / revoked / forged session | Treated as a visitor | No | No |

The preview policy is the same in the front end (player loads `/api/movies/:slug/playback`) and the back end (`/media/...` checks on every request). The browser's choice is never trusted: the server decides from the session cookie, the database and the playlist.

**The 30-minute rule is about media time, not wall-clock time.** The preview playlist contains only segments whose end falls at or before the configured free minutes (default 30:00 = 1800 s of the film). Playback therefore stops at the film's 30:00 mark however long the viewer takes, and seeking cannot go beyond it because the later segments are not in the playlist and are refused by the server. With 23.976/29.97 fps films the segments are about 6.006 s long, so the preview stops at the last whole segment, up to ~6 s early (e.g. 29:55). It never runs over. Verified on real encoded media in `tests/preview-media.test.js` (timestamps, continuity, audio/video sync, decoding, seeking).

## What is enforced on the server
* Every playlist and every segment request: published? entitled? Segment names must match `seg_NNNNN.ts`; nothing else under `/media` is served; no directory listing; no path from the URL reaches the filesystem.
* Original films, partial uploads, the database, backups and processed HLS live outside any web-served directory (`/srv/yp/...`, mode 700). `/uploads` serves only public images.
* No secrets, filesystem paths or private media URLs are returned by any API; admin error text has paths scrubbed; logs are structured and redacted (`server/log.js`); malformed request bodies are never logged.
* Sessions: HttpOnly, SameSite=Lax, Secure in production, 14-day signed JWT with an id; logout revokes that exact token; password change/reset, role change and admin revoke end other sessions; HS256 only.
* Passwords: bcrypt (cost 11), 8 to 72 bytes. Rate limits: login/register/reset/Google (30 per 15 min per IP, configurable), payments, and a global `/api` limit. nginx adds its own login limit.
* CSRF: state-changing requests must be same-origin (Origin header) and cookies are SameSite=Lax; there is no CORS.
* Admin: every `/api/admin` route requires an admin session checked in the database on each request. Upload sessions belong to the admin who started them.
* Payments: see `PAYMENTS.md`: server-side prices, signature checks, authoritative lookups, idempotency, one payment per order, transactional ledger.
* Dependencies: production dependencies only (`npm ci --omit=dev`); `npm audit --omit=dev` reported 0 known vulnerabilities at the time of the last run.

## Limitations you should know about (honest list)
1. **No DRM.** HLS is served in clear (no encryption keys). A paying viewer can capture the stream or record the screen, and anything a browser has downloaded or cached cannot be recalled. Per-request authorisation stops casual sharing of links and non-buyers, not a determined buyer.
2. **Why not expiring signed URLs?** A 2.5-hour film outlives any short-lived URL (it would need a token-refresh protocol), Safari's native HLS cannot rewrite segment URLs, and a signed URL would keep working after a refund until it expired. The per-request database check revokes immediately. If a CDN is added later, signed URLs (or signed cookies) become necessary and the design must be revisited.
3. **Browser caching:** segments are sent `Cache-Control: private` (`max-age=3600`) so a browser may keep them for an hour; playlists are `no-store`.
4. **Account sharing:** one purchase works for one account on any number of devices. There is no concurrent-stream limit.
5. **Email is not verified** for password accounts and there is no automatic password-reset email (no email service is configured). Recovery is an admin-issued one-time link. Google accounts have verified emails.
6. **Partial refunds keep access** (policy), cumulative full refunds revoke. Open disputes keep access and are flagged; lost disputes revoke; admins can revoke manually.
7. **Webhook formats were written from the gateways' documentation and are tested with simulated payloads. NOT VERIFIED against live Razorpay/Cashfree traffic.** Do the sandbox runs in `PAYMENTS.md` before launch.
8. **iOS Safari** native HLS playback is implemented (fallback path) but **was not tested on a real iPhone**; only Chromium (desktop and phone emulation) was.
9. **SQLite single node:** one server, one process. Fine for this workload; it is not a high-availability design.
10. The admin account is a single point of risk: use a long password and consider limiting `/admin` by IP in nginx.

## Reporting / hardening checklist for the server
See `DEPLOYMENT.md` and `GO_LIVE.md`.
