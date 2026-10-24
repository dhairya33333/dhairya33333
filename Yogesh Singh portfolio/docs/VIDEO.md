# Movies: upload, FFmpeg processing and publishing

All files stay on the VPS. Nothing is sent to an external storage or streaming service.

## Where files live
| What | Default location (`.env` variable) | Served publicly? |
|---|---|---|
| Original uploads | `SOURCE_DIR` (`/srv/yp/originals`) | **Never.** Not under any web path |
| Files dropped via SFTP | `INCOMING_DIR` (`/srv/yp/incoming`) | **Never.** Left untouched after import |
| Partial uploads | `UPLOAD_TMP_DIR` | Never |
| Processed HLS (`index.m3u8`, `seg_00000.ts` …) | `MEDIA_DIR/<movie id>/` | Only through the gated `/media/…` route |
| Posters, trailers, feed thumbnails | `DATA_DIR/uploads` | Yes (they are public images) |
| Database backups | `BACKUP_DIR` | Never |

Admin → Dashboard → *Disk & storage* shows free space and the size of each bucket.

## Uploading a 10.8 GB original
Two supported ways, both resumable/safe:

**A. Browser upload (Admin → Films → Manage → "Upload from this computer").** The file is sent in 32 MB pieces straight to disk, so server memory stays flat. If the connection drops it retries each piece up to 5 times; if you close the tab, choose the same file again and it resumes from where the server stopped. Before starting, the server checks the file type, the size limit (`MAX_UPLOAD_BYTES`, default 16 GB) and free disk (`file size + MIN_FREE_BYTES`). Needs about the file size free in `UPLOAD_TMP_DIR`.

**B. SFTP / scp (recommended for the very large film).**
```bash
scp film.mp4 youruser@yourserver:/srv/yp/incoming/        # or any SFTP client
```
then Admin → Films → Manage → choose the file under "Process". The original stays in the incoming folder.

Upload and encode status are tracked per upload: `uploading → queued → processing → completed | failed`, visible under *Recent uploads*.

## Processing (FFmpeg → HLS)
One background job per film, run once. Viewers never trigger transcoding.
* H.264 (High, yuv420p) + AAC 128 kb/s stereo, **720p** (never upscaled: a 480p source stays 480p).
* CRF 22 with a bitrate cap (`HLS_MAXRATE_KBPS`, default 3500) so size and bandwidth are predictable.
* 6-second segments cut on forced keyframes (`HLS_SEGMENT_SECONDS`), `independent_segments`, audio resampled to stay in sync.
* Runs at low CPU priority (`nice`), `ENCODE_CONCURRENCY=1` (more would starve a small VPS).
* Output goes to a temporary directory, is **validated**, then swapped in. Validation: end marker present, every segment exists and is non-empty and a valid name, no segment longer than the target + 2 s, total length within 2% (min 3 s) of the source, first and last segment decodable.
* **Failure never touches the original and never takes down a published film**: a failed re-process keeps the previous version live, only the temp output is removed, and the reason is shown in admin.
* After a server restart interrupted jobs are marked failed (press *Re-process*).

## Measured results (this build, test machine: 4 vCPU, 16 GB RAM, Ubuntu, FFmpeg 6.1)
The real 10.8 GB film was **not available**, so these use a synthetic stand-in made to resemble it: 5 minutes of 1920×1080, 24 fps, H.264 with added grain at **9.76 Mb/s** (the real film is about 9.6 Mb/s: 10.8 GB over 2.5 h). Synthetic noisy content is a hard case for the encoder, so real footage may behave differently. **Repeat the measurement on the VPS with the real file** (it does not touch the database or any published film):
```bash
node scripts/measure-encode.js /srv/yp/incoming/film.mp4
```
| Measurement | Result |
|---|---|
| Source → output | 349 MB / 9.76 Mb/s → **134 MB / 3.75 Mb/s** (38% of the source; 50 segments; validation passed) |
| Encode time | 92 s for 300 s of film = **3.26× real time** on 4 vCPU |
| CPU / memory of ffmpeg | 3.7 cores busy on average, **peak 255 MB RAM** |
| Projection for 2 h 30 m on this machine | about 0.8 h and about 3.9 GB. A 2-vCPU VPS has roughly half the CPU, so **assume 1.5 to 2 hours** until measured (this is an extrapolation, not a measurement) |
| Output bitrate | the cap is 3.5 Mb/s video + 128 kb/s audio ≈ 3.63 Mb/s (+ container overhead ≈ 3.75 Mb/s). Output size is therefore **bounded by the cap (about 4.1 GB for 2.5 h) whatever the source**, but it is **not guaranteed to be smaller than a low-bitrate source**: a 2 Mb/s source can legitimately become a larger 720p file |

### Disk space needed (practical)
Worst case is planned with the bitrate cap, not an optimistic average, and not as a fraction of the source:
```
original film (uploaded to /srv/yp/originals, or in /srv/yp/incoming)     10.8 GB
partial upload while uploading (same disk; renamed, not copied)            +0 GB after finish, 10.8 GB during upload of the file itself
processed HLS, worst case at the cap (2.5 h)                                4.1 GB
previous live HLS kept while a re-process runs (swap needs both)            4.1 GB
poster, trailer, thumbnails, database, local DB backups                     ~1 GB
operating system, packages, logs                                            ~8 GB
always-free reserve the app enforces (MIN_FREE_BYTES)                       5 GB
                                                                           ---------
minimum comfortable total                                                  ~34 GB    →  buy 60 GB or more
```
If the original is uploaded through the browser *and* also kept in `incoming`, add another 10.8 GB. Local backups of the original are not counted: keep that copy **off the server**. The app refuses an upload or an encode that would break the reserve, using these same numbers.

### Large upload test (measured)
`SIZE_GB=10.8 node scripts/measure-upload.js` uploads 10.8 GB of dummy data through the real chunked API (32 MB pieces with SHA-256 per piece) into a throw-away server:
| | |
|---|---|
| Result | 10.8 GB written, **file size on disk identical**, in 174 s (63 MB/s over loopback) |
| Server memory | **113 MB at the start, 117 MB at the end, 118 MB peak**: flat, the file is streamed to disk, never held in RAM |
| End of upload | the dummy file was correctly rejected as "not a readable video" and kept, not deleted |
This proves the server side. It does **not** test your internet connection, nginx, or a browser holding a 10.8 GB file: use the SFTP route for the very large original if your connection is unreliable.

## Publishing
1. Fill title, tagline, description, price, free minutes (default 30; changing it later needs no re-encode).
2. Wait for status *Ready to stream. Passed validation*.
3. Open the film page as admin and play it (admins always see the full film). **Check the picture, seek around, and listen for audio sync before publishing**: automated checks cannot judge visual quality.
4. Tick *Published* (the server refuses to publish a film that has not passed validation) and *Featured* if wanted → Save.

The free preview is the whole segments that **end** at or before the free-minutes mark, so playback can never run past it (it may stop up to 6 s early). Preview length is shown to viewers.

## Removing the original (optional, explicit)
*Remove original…* appears only after the film is validated. You must type `DELETE`. It deletes only uploaded originals in `SOURCE_DIR`. **Keep your own off-server copy first.** Deleting a film never deletes its original; a film that still has an uploaded original cannot be deleted until you remove it deliberately.

## Quality and adaptive bitrate (not in the first release)
Only one 720p rendition is produced. 1080p + 720p adaptive streaming is a possible later step if the source is truly 1080p and the VPS can afford ~2× the encode time and ~2.5× the storage; it needs a master playlist and a player quality setting. Test actual visual quality of the 720p result first.

## Capacity: what was measured, and what was not
**Measured: how much work this application can do on one machine** (`scripts/load-viewers.js`). A throw-away server streamed the 720p film above (6 s segments, 2.7 MB each, 3.75 Mb/s per viewer) to N virtual signed-in buyers, each paced like a real player (3 segments to fill the buffer, then one segment per 6 s), with a database purchase check on every request. Test machine: 4 vCPU / 16 GB, **loopback network (no internet involved)**, load generator on the same machine (which inflates latency a little):

| Virtual viewers | Errors | Segment latency p50 / p95 / p99 | App CPU (share of ONE core) | App memory |
|---|---|---|---|---|
| 10 | 0 | 12 / 24 / 27 ms | 3% | 118 MB |
| 50 | 0 | 10 / 19 / 24 ms | 11% | 119 MB |
| 100 | 0 | 10 / 21 / 26 ms | 21% | 122 MB |
| 200 | 0 | 15 / 34 / 48 ms | 44% | 126 MB |
| 400 | 0 | 94 / 1438 / 1694 ms | 54% | 159 MB |
| 800 | 0 | 414 / 4198 / 11784 ms | 85% | 202 MB (delivered 2.66 Gb/s of the 3.0 Gb/s needed: saturated) |

Reading it honestly: on this hardware the Node process is **not** the limit up to roughly 200 concurrent viewers (latency stays in milliseconds and it uses under half a core); latency degrades at 400 and the process saturates between 400 and 800 (it is single-threaded). A 2-vCPU VPS will have less headroom than this 4-vCPU test machine; **measure on the real server**.

**Not measured, and not promised: the number of viewers the real service supports.** That is set by the VPS's outbound bandwidth and monthly transfer, which loopback cannot show:
```
viewers you can serve at once  ≈  usable uplink in Mb/s ÷ 3.75      (a 500 Mb/s uplink ≈ 130 viewers, ignoring everything else)
data per full viewing          ≈  4 GB (2.5 h × 3.75 Mb/s)
1,000 full viewings            ≈  4 TB of transfer
```
Check your Hostinger plan's port speed and transfer allowance, then run a real test from outside the server (e.g. 10, 25, 50 simultaneous players on different networks) before announcing any capacity. If demand outgrows the VPS, a CDN in front of `/media` is the next step; it changes the access-control design (signed URLs/cookies) and costs extra, so it needs the client's approval. Also keep in mind the encode job uses ~3.7 cores while it runs: **do not encode while many people are watching** on a small VPS (the service already runs it at low priority).
