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

Before encoding the server checks disk space for the estimated output. Estimates (shown after upload):
```
output size  ≈ duration × (2.5 Mb/s video + 0.128 Mb/s audio) / 8        (upper bound uses the 3.5 Mb/s cap)
2 h 30 min   ≈ 3.0 GB typical, ≈ 4.1 GB at the cap
encode time  : unknown until measured. Set ENCODE_SPEED_X after the first run
```
The real encode time and speed (× real time) are logged (`journalctl -u yogesh-portfolio | grep encode`) and stored on the film. On a 2-vCPU VPS with the `veryfast` preset a 1080p-to-720p encode is plausibly 1–2× real time, i.e. roughly 1.5–3 hours for a 2.5 h film. **That is an estimate, not a measurement.**

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

## Capacity: do not guess
Each viewer streams about 2.6–3.6 Mb/s. Concurrent viewers ≈ (usable uplink in Mb/s) ÷ 3.6, and monthly traffic ≈ 3–4 GB per full viewing. Check your Hostinger plan's bandwidth/transfer allowance, then measure with a load test (e.g. 10, 25, 50 simultaneous players) before promising a number. If demand grows, put a CDN in front of `/media` (this changes the access-control design and costs extra, so it needs approval).
