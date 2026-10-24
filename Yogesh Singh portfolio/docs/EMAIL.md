# Email (optional)

Without email the site works as before: contact messages wait in **Admin → Inbox**, and password resets are one-time links the admin issues in **Admin → Users**. With email you also get:

| Email | To | When |
|---|---|---|
| New message | `NOTIFY_EMAIL` (else the contact email in Site content) | someone sends the Contact form. "Reply" goes to the sender |
| Purchase receipt | the buyer | once per paid order |
| New sale | `NOTIFY_EMAIL` | once per paid order |
| Password reset | the account's address | the visitor chooses "Email me a reset link" on the sign-in page (shown only when email is configured). Link works once, 60 minutes |

## Setup
Any SMTP account works (your domain's mail host, Zoho, Brevo, Amazon SES, Gmail with an app password). In `/etc/yogesh-portfolio/env`:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587          # 465 uses implicit TLS; 587 uses STARTTLS
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM="Yogesh Singh <no-reply@yourdomain.com>"
NOTIFY_EMAIL=owner@yourdomain.com
```
Restart the app, then press **Admin → Dashboard → Send test email**.

## Delivery tips
Send from an address on your own domain and add the SPF and DKIM records your mail provider gives you, or receipts will land in spam. The receipt is a payment confirmation, not a GST invoice.

## Behaviour and limits
* A mail failure never breaks the form or the payment; it is logged (`mail.failed`) without addresses or passwords. Nothing is retried, so check the test email after any change.
* **Not verified against a real mail server** in this project's tests (a stand-in transport is used). Do the test email and one real purchase before launch.
