# Go-live checklist

Tick every line; most items need the client's accounts and cannot be done by the developer alone.

**Accounts and keys (client)**
- [ ] Domain points to the VPS; HTTPS works (`https://` padlock, HTTP redirects)
- [ ] Razorpay account KYC-approved, **Live** keys and **live webhook** (`/api/payments/webhook`, events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`) entered in `/etc/yogesh-portfolio/env`
- [ ] Google OAuth consent screen published to Production, production origin added, `GOOGLE_CLIENT_ID` set
- [ ] Refund/cancellation, terms, privacy and contact pages published (gateway requirement)

**Staging first (do not skip)**
- [ ] Deploy to a staging subdomain (or the real VPS before announcing) with Razorpay **test** keys and a Google OAuth client allowing that origin
- [ ] Run the whole checklist below there; only then switch to live keys

**Server**
- [ ] `systemctl status yogesh-portfolio` active; `nginx -t` OK
- [ ] `JWT_SECRET` set (random, 32+ chars); env file mode 600; no secrets in git
- [ ] Admin account created; password changed from any temporary one; admin sign-in works
- [ ] Disk: ≥ 20% free after the film is uploaded and processed
- [ ] Nightly backup ran once; the file restores (practice the restore); off-server copy of the **original film** exists
- [ ] `ufw status` shows only SSH/80/443; fail2ban active
- [ ] `curl https://yourdomain/healthz` returns `{"ok":true}`; Admin → Dashboard shows *ffmpeg ok*
- [ ] **Reboot the VPS once** and confirm the site comes back by itself (not tested in the build environment)
- [ ] `npm run verify-data` prints "Data is consistent"
- [ ] Permissions: `ls -ld /var/lib/yogesh-portfolio /srv/yp/*` show `drwx------` (incoming is `drwxrws---`); `/etc/yogesh-portfolio/env` is `-rw-------`
- [ ] Restore drill performed on the real server (see DEPLOYMENT.md)

**Film**
- [ ] Original uploaded (or imported) and processed, status *Ready*, validation passed
- [ ] Watched the whole film as admin: picture, audio sync, seeking, ending
- [ ] Price, tagline, description, poster set; free preview minutes = 30
- [ ] Published; appears on Films page and homepage

**Money and access (do this in Razorpay TEST mode first, then once live with a small real payment)**
- [ ] Logged-out visitor: first 30 minutes play, then the paywall; typing a later segment URL returns 401
- [ ] Signed-in unpaid user: same, 403 on paid segments
- [ ] Pay with a test card/UPI: film unlocks, resumes at the right place, Admin → Orders shows `PAID`
- [ ] Close the payment window: no access, a clear message, retry works
- [ ] Webhook delivery shows 200 in the Razorpay dashboard; a re-sent webhook does not create a second purchase
- [ ] Refund the test payment: access disappears
- [ ] Password recovery: issue a reset link from Admin → Users for a test account and use it once; the second use must fail
- [ ] Google sign-in: new account works; existing email+password account is *not* merged but can connect Google from My account
- [ ] Phone check on a **real iPhone (Safari)** and a real Android phone (Chrome): browse, sign in, pay, play, seek, rotate. iOS Safari has not been tested at all yet
- [ ] From outside the server, play the film from two or three different networks at the same time and watch the server (`top`, `journalctl`)

**Pages**
- [ ] Contact page: send a real test message; it appears in Admin → Inbox with the unread badge; "Reply by email" opens your mail app
- [ ] Contact email, phone and city entered in Admin → Site content (shown on the Contact page)
- [ ] Social page: paste at least 3 real Instagram post/reel links in Admin → Social feed and confirm each shows a cover image and caption (if one has no cover, press "Fetch cover" or upload one), opens in the viewer and plays, on a computer **and a phone** (this needs the real Instagram and the account must be public; it has not been exercised against live Instagram)
- [ ] About page text reviewed by Yogesh Singh

**Content**
- [ ] Homepage text, biography, awards, links and contact email replaced with Yogesh Singh's real content (currently placeholders built from public sources; verify every fact)
- [ ] Articles/press entries added (Admin → Journey, type *article*)
- [ ] Instagram token added (optional)

**After launch**
- [ ] Watch `journalctl -u yogesh-portfolio -f` and Admin → Orders during the first sales
- [ ] Load-test before any promotion; record the number of concurrent viewers the plan really supports
