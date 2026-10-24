# Payments: test and production setup

One-time payment per film. Razorpay is the default provider (`PAYMENT_PROVIDER=razorpay`) because the original quotation names it. Cashfree is still available (`PAYMENT_PROVIDER=cashfree`) because it was already built and verified. Only one provider is active at a time; both go through the same ledger (`server/payments/ledger.js`). If the client will only ever use one, delete the other provider file.

## How a purchase works
1. The signed-in viewer presses *Unlock*. `POST /api/payments/checkout` loads the film, **takes the price and currency from the database**, creates an `orders` row (`CREATED`) and a gateway order.
2. The gateway's checkout opens in the browser.
3. **Razorpay:** on success the browser sends `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` to `POST /api/payments/razorpay/verify`. The server checks `HMAC_SHA256(order_id|payment_id, key_secret)`, loads the payment from Razorpay's API, and requires `status = captured` and amount/currency equal to our order. Only then is the film unlocked.
4. Independently, Razorpay calls the **webhook** `POST /api/payments/webhook` (signature `X-Razorpay-Signature` over the raw body). This covers closed tabs and slow banks.
5. The return page (`/payment-return.html?order_id=…`) ignores everything in the URL except the order id and asks `GET /api/payments/verify`, which answers from our database (and reconciles with the gateway if still open).

| Event | Effect |
|---|---|
| Valid signature + captured, amount and currency match | `PAID`, purchase row created (once) |
| Invalid signature, wrong amount/currency, order of another user | Nothing unlocked, logged |
| Same webhook delivered again (same event id) | Acknowledged, not reprocessed; `payment_events` keeps one row |
| `payment.failed` | `FAILED` with reason (cannot downgrade a paid order) |
| User closes checkout | `CANCELLED` (a late successful payment still unlocks) |
| Full refund (`refund.processed`) | `REFUNDED`, access revoked on the next request; a replayed capture cannot restore it |
| Partial refund | Access kept (decide policy with the client) |
| Gateway down while creating the order | HTTP 502 "You have not been charged"; retry works |
| New checkout while an old one is open | Old one closed, so open orders do not pile up |

Transactions are persistent: `orders` (provider, provider ids, amount, currency, status, timestamps, failure reason), `purchases` and `payment_events`. Admin → Orders lists them.

## Razorpay test mode (no real money)
1. Sign up at <https://dashboard.razorpay.com/>, stay in **Test Mode** (toggle top of the dashboard).
2. **Account & Settings → API Keys → Generate Test Key**: copy Key Id (`rzp_test_…`) and Key Secret (shown once).
3. **Account & Settings → Webhooks → Add new webhook**: URL `https://yourdomain.com/api/payments/webhook`, a secret you invent (long random), events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`. (The URL must be public HTTPS; for a laptop use a tunnel such as `cloudflared`/`ngrok`.)
4. Set in the env file:
   ```
   PAYMENT_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=the-webhook-secret-you-chose
   ```
5. Pay with Razorpay's test cards/UPI (<https://razorpay.com/docs/payments/payments/test-card-upi-details/>), e.g. UPI `success@razorpay`. Confirm: film unlocks, Admin → Orders shows `PAID`, Razorpay dashboard shows the webhook delivered. Refund a test payment from the dashboard and confirm access disappears.

## Production
* Razorpay requires **KYC and account activation** (business/individual documents, bank account, website with pricing/refund/terms/privacy/contact pages). Approval is on Razorpay's side and can take days; start early.
* Switch the dashboard to **Live Mode**, generate **Live keys** and a **live webhook** (same URL, new secret), replace the three values, restart. Never reuse test keys or secrets.
* Transaction fees (about 2% plus GST at the time of writing; confirm on Razorpay) are paid by the client directly.
* Keep keys only in `/etc/yogesh-portfolio/env` (mode 600). They never reach the browser (only the public Key Id does).
* Publish refund/cancellation, terms and privacy pages before going live; the gateway will ask for them.

## Cashfree (alternative)
`PAYMENT_PROVIDER=cashfree`, `CASHFREE_ENV=sandbox|production`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`; webhook URL as above. Cashfree needs the buyer's 10-digit mobile number, so checkout asks for it. Cashfree has no refund webhook handling in this code; refunds there must be revoked manually (Admin → Users).

## Demo mode
With no keys outside production the buy button completes instantly (clearly labelled "Demo"). In production without keys, checkout is disabled with an error.

## Verified vs not verified
Automated (`tests/payments.test.js`, `tests/streaming.test.js`): signature verification, wrong/missing signature, authorized-only, amount mismatch, IDOR, duplicate webhooks, refunds (full/partial/replay), cancel then late payment, reconcile, persistence, payment-then-playback. The Razorpay HTTP API is **faked** in tests, so **no real or sandbox transaction has been performed**; do the test-mode run above before launch.
