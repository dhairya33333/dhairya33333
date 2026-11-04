# Client preview on Railway

Purpose: an always-on `https://…up.railway.app` link to send clients **before** the real VPS. It is a preview, not the live site: payments are fake and the plan is small.

**Not verified:** the Dockerfile could not be built in the environment where it was written (no Docker daemon). Everything it runs was checked outside Docker (the app in production mode with the same variables, the admin bootstrap, ffmpeg with WebP). Expect to fix a small thing on the first deploy and tell the developer what the build log says.

## What is in the project for this
| File | What it does |
|---|---|
| `Dockerfile` | Node 22 + ffmpeg, installs dependencies, starts the app. Data lives in `/data` |
| `railway.json` | Tells Railway to use the Dockerfile and to check `/healthz` |
| `scripts/bootstrap-admin.js` | On start, creates the first admin from `ADMIN_*` variables, only if no admin exists |
| `ALLOW_DEMO_PAYMENTS=true` | Preview-only switch: "Unlock" works without any money moving. Real gateway keys always override it |

## Steps
1. **Put the project on GitHub**, or use the Railway CLI (step 2b). If the repository has the project in a sub-folder, you must set *Root Directory* (below).
2. **Create the service.**
   a. In Railway: *New Project → Deploy from GitHub repo →* pick the repo. Then *Service → Settings → Source → Root Directory* = `Yogesh Singh portfolio` (if the project is in that sub-folder).
   b. Or from the project folder on your computer: `npm i -g @railway/cli`, `railway login`, `railway init`, `railway up`.
3. **Add a volume** (this is what keeps the database, uploads and films between deploys): *Service → right-click the canvas / Command Palette → Add Volume*, mount path **`/data`**. Without it everything is erased on every deploy.
4. **Generate the link:** *Service → Settings → Networking → Generate Domain*. Copy it (for example `https://yp-preview.up.railway.app`).
5. **Set variables** (*Service → Variables*):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `SITE_URL` | the https link from step 4, no trailing slash |
   | `JWT_SECRET` | a long random string (40+ characters) |
   | `DATA_DIR` | `/data` |
   | `ALLOW_DEMO_PAYMENTS` | `true` |
   | `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | your preview admin (password 10+ characters) |

   Optional: `SMTP_*` and `NOTIFY_EMAIL` (docs/EMAIL.md), `GOOGLE_CLIENT_ID` (add the Railway link to Google's allowed origins).
6. **Deploy.** Watch *Deployments → View logs* for `Portfolio running on https://…  (payments: demo …)`. Open the link, sign in at `/login.html` with the admin, go to `/admin`.
7. **After the first start, delete `ADMIN_PASSWORD`** from the variables. It is only needed to create the admin once.

## Before you send the link
* Upload a **short test film** (2 to 5 minutes), not the real 2.5-hour film. Railway's CPU is small, so a long encode is slow, and your plan's volume may be smaller than the 10.8 GB original (check *Volume → Settings*).
* In Admin, publish the film and fill the About, Contact and legal text. The dashboard will show "Payments: demo".
* Tell clients it is a preview: purchases are simulated and nothing is charged.
* The site is indexable by default. Do not post the link publicly, and shut the service down when the preview is over.

## When you move to the VPS
Nothing to migrate by hand if you want to keep the content: the whole state is the `/data` folder (database in it, uploads, films). Otherwise start the VPS clean (docs/DEPLOYMENT.md) and **do not** copy `ALLOW_DEMO_PAYMENTS` to it: the live site must use real Razorpay keys.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| Build fails | Send the build log. Most likely a missing file or a Node/ffmpeg install problem |
| "Application failed to respond" / health check fails | `SITE_URL` not https, or `JWT_SECRET` shorter than 32 characters (the app refuses to start; the log says so) |
| Everything is empty after a deploy | The `/data` volume is missing or mounted somewhere else |
| Cannot sign in as admin | an admin already existed when `ADMIN_*` were set (the script never changes an existing admin). Use the password you first set, or delete the volume's contents (Volume → Settings) and redeploy to start fresh |
| Films fail to process | Too little CPU/memory on the plan, or the disk is full: use a shorter film |
