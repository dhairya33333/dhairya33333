# Free client preview on Render

Free, no card needed at the time of writing (check render.com). Fine for a preview **before any film is uploaded**. Know the trade-offs:
* The free service **falls asleep after about 15 minutes without visitors**; the next visitor waits roughly a minute while it wakes up. Tell clients to wait and refresh.
* The free disk is **not permanent**: the database, uploads and any film are erased whenever the service restarts or redeploys. The admin account is re-created automatically each start from the `ADMIN_*` variables, but content edited in the admin panel is lost. Keep the admin variables set (do not delete `ADMIN_PASSWORD` here).
* Small CPU and memory: do not upload a long film. Not for the real launch.

**Not verified:** this exact deploy has not been run on Render (the Dockerfile could not even be built where it was written). If the build fails, send the log.

## Steps
1. Make sure the project is on GitHub (branch `claude/charming-archimedes-jydp99` of `dhairya33333/dhairya33333`).
2. render.com → sign in with GitHub → **New → Web Service** → pick the repository.
3. Fill in:
   | Field | Value |
   |---|---|
   | Branch | `claude/charming-archimedes-jydp99` |
   | Root Directory | `Yogesh Singh portfolio` |
   | Runtime / Language | **Docker** |
   | Instance Type | **Free** |
   | Health Check Path (Advanced) | `/healthz` |
4. **Environment Variables** (Add each):
   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | any long random text, 40+ characters |
   | `DATA_DIR` | `/data` |
   | `ALLOW_DEMO_PAYMENTS` | `true` |
   | `ADMIN_NAME` | your name |
   | `ADMIN_EMAIL` | your preview admin email |
   | `ADMIN_PASSWORD` | 10+ characters |

   `SITE_URL` is not needed: the app reads Render's own address automatically.
5. **Create Web Service.** The first build takes several minutes. When the log shows `Portfolio running on https://….onrender.com`, open that link.
6. Sign in at `/login.html` with the admin, then `/admin`. Send clients the `onrender.com` link.

## Keeping it awake
Free services sleep when idle. For a client call, open the link yourself a minute before so it is awake. A free pinger (for example UptimeRobot hitting `/healthz` every 5 minutes) can keep it awake, but Render may still restart it, which erases the data.

## When you are ready for a real film
Move to a server with a permanent disk (docs/DEPLOYMENT.md). Do not copy `ALLOW_DEMO_PAYMENTS` to the live site.
