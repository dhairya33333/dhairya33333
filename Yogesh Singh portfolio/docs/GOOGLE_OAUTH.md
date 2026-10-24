# Google sign-in: setup guide

Google sign-in sits next to email/password. It uses Google Identity Services: the browser gets a signed **ID token** from Google and posts it to `POST /api/auth/google`, where the server verifies it with Google's maintained `google-auth-library` (signature against Google's public keys, issuer, audience = your Client ID, expiry). It additionally requires `email_verified: true`. Sessions use the same cookie as password login.

Only the **Client ID** is needed for this flow. There is no client secret and no redirect/callback URL to host, because the token is returned to the page in a pop-up, not through a server redirect. (If a redirect flow is ever added, the callback would be `https://YOURDOMAIN/api/auth/google/callback`; none exists today.)

## 1. Create the credentials (about 10 minutes, free)
1. Go to <https://console.cloud.google.com/> and create a project (e.g. "YP Singh website").
2. **APIs & Services → OAuth consent screen**: choose *External*, app name, support email, developer email. Add your domain under *Authorized domains*. Scopes: the defaults (`openid`, `email`, `profile`) are enough. Publish the app to **Production** (otherwise only test users can sign in).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
4. **Authorized JavaScript origins** (exact, no trailing slash, no path):
   * `https://yourdomain.com`
   * `https://www.yourdomain.com` (if used)
   * `http://localhost:3000` (for local testing only)
5. **Authorized redirect URIs**: leave empty for this flow.
6. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## 2. Configure the server
Put it in the environment file (never in code or git):
```
GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
```
Restart (`systemctl restart yogesh-portfolio`). The "Continue with Google" button appears on the sign-in page and "My account". The admin dashboard shows *Google sign-in: on*.

## 3. How accounts are matched (security behaviour)
| Situation | Result |
|---|---|
| Google `sub` already known | Signed in to that account |
| New `sub`, email not used | New account created (email is Google-verified, no password) |
| New `sub`, **email already registered** | **Refused (409).** Never merged automatically, because a password account's email was never verified and could have been pre-registered by someone else. The owner signs in with their password and presses "Connect Google" on *My account* |
| Linking while signed in | Allowed only if the Google email equals the account email and that Google identity is not used elsewhere |
| Google-only accounts | Cannot be entered with a password; they can set one later from *My account* |
| Admin accounts | Never reachable through Google by email match |

Rate limits apply to the endpoint, and the same-origin check protects state-changing calls. Because the ID token is delivered to the page and posted over HTTPS, `SameSite=Lax` cookies and the `Origin` check cover CSRF.

## Troubleshooting
* *"Not a valid origin for the client"*: the exact site origin is missing from **Authorized JavaScript origins**.
* Button missing: `GOOGLE_CLIENT_ID` empty, or Google's script blocked by an ad blocker.
* "Google sign-in could not be verified": Client ID in `.env` differs from the one the page used, or the server clock is wrong (`timedatectl`).

Tested: `tests/google.test.js` (valid token, wrong audience/issuer/signature/expiry, unverified email, forged `alg=none`/HS256 tokens, account creation, no duplicate accounts, takeover protection, linking rules, rate limit). The tests sign tokens with a local key; **a live end-to-end sign-in with a real Google account has not been run** and needs your Client ID.
