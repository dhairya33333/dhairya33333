import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, dirs } from './config.js';
import { db } from './db.js';
import { freeBytes, estimateEncode, hlsDir } from './storage.js';
import { parsePlaylist } from './hls.js';
import { randomId } from './auth.js';
import { log, scrub } from './log.js';

const queue = [];
let active = 0;
const running = new Map();   // movieId -> { child, cancelled }

function run_(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err = (err + d).slice(-800)));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} exited ${code}`))));
  });
}

/** Reads container info. Throws a readable error for anything that is not a playable video. */
export async function probe(file) {
  let info;
  try { info = JSON.parse(await run_('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file])); }
  catch { throw new Error('This file is not a readable video (ffprobe could not open it).'); }
  const video = (info.streams || []).find((s) => s.codec_type === 'video');
  const duration = parseFloat(info.format?.duration);
  if (!video) throw new Error('The file has no video stream.');
  if (!(duration > 0)) throw new Error('Could not determine the video duration.');
  return { duration, height: video.height, width: video.width, hasAudio: (info.streams || []).some((s) => s.codec_type === 'audio'), bytes: Number(info.format?.size) || 0 };
}

/** Checks a finished HLS directory before it may replace/publish anything. */
export async function validateOutput(dir, sourceDuration) {
  const fail = (error) => ({ ok: false, error });
  const playlist = path.join(dir, 'index.m3u8');
  if (!fs.existsSync(playlist)) return fail('No playlist was produced.');
  const { segs, ended } = parsePlaylist(fs.readFileSync(playlist, 'utf8'));
  if (!ended) return fail('The playlist is incomplete (no end marker).');
  if (!segs.length) return fail('The playlist has no segments.');
  let bytes = 0, sum = 0;
  for (const s of segs) {
    if (!/^seg_\d{5}\.ts$/.test(s.name)) return fail(`Unexpected segment name: ${s.name}`);
    let st; try { st = fs.statSync(path.join(dir, s.name)); } catch { return fail(`Missing segment ${s.name}.`); }
    if (st.size === 0) return fail(`Empty segment ${s.name}.`);
    if (s.dur > config.encode.segment + 2) return fail(`Segment ${s.name} is ${s.dur.toFixed(1)}s long.`);
    bytes += st.size; sum += s.dur;
  }
  const tolerance = Math.max(3, sourceDuration * 0.02);
  if (Math.abs(sum - sourceDuration) > tolerance) return fail(`Output length ${Math.round(sum)}s does not match the source ${Math.round(sourceDuration)}s.`);
  for (const s of [segs[0], segs[segs.length - 1]]) {
    try {
      const i = JSON.parse(await run_('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path.join(dir, s.name)]));
      if (!(i.streams || []).some((x) => x.codec_type === 'video')) return fail(`Segment ${s.name} has no video.`);
    } catch { return fail(`Segment ${s.name} cannot be decoded.`); }
  }
  return { ok: true, segments: segs.length, bytes };
}

export function ffmpegArgs(src, out) {
  const e = config.encode;
  const args = [
    '-y', '-nostdin', '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', e.preset, '-crf', String(e.crf),
    '-maxrate', `${e.maxrateKbps}k`, '-bufsize', `${e.maxrateKbps * 2}k`,   // bounded bitrate: predictable size and bandwidth
    '-vf', `scale=-2:'min(${e.height},ih)'`,                                // never upscale a smaller source
    '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-force_key_frames', `expr:gte(t,n_forced*${e.segment})`, '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0',   // keeps audio in sync with video
    '-max_muxing_queue_size', '1024',
    '-f', 'hls', '-hls_time', String(e.segment), '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(out, 'seg_%05d.ts'),
    '-progress', 'pipe:1', '-nostats',
    path.join(out, 'index.m3u8'),
  ];
  if (e.threads > 0) args.splice(2, 0, '-threads', String(e.threads));
  return args;
}

const niceBin = fs.existsSync('/usr/bin/nice') ? '/usr/bin/nice' : null;

function setMovie(movieId, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE movies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), movieId);
}
const setUpload = (uploadId, status, error = null) => uploadId &&
  db.prepare("UPDATE uploads SET status = ?, error = ?, updated_at = datetime('now') WHERE id = ?").run(status, error, uploadId);

async function runJob({ movieId, src, uploadId }) {
  const started = Date.now();
  const wasReady = db.prepare('SELECT status FROM movies WHERE id = ?').get(movieId)?.status === 'ready';
  const tmpOut = path.join(dirs.media, `${movieId}.tmp-${randomId(4)}`);
  const failJob = (message) => {
    fs.rmSync(tmpOut, { recursive: true, force: true });   // partial output only. The original and any live output are untouched
    const safe = scrub(message).slice(0, 500);      // admin-visible text never contains server paths
    log('error', 'encode.failed', { movie: movieId, message: safe });
    setMovie(movieId, { encode_state: 'failed', error: safe, ...(wasReady ? {} : { status: 'failed' }) });
    setUpload(uploadId, 'failed', safe);
  };
  try {
    if (!fs.existsSync(src)) throw new Error('The original file is missing on the server.');
    const info = await probe(src);
    const est = estimateEncode(info.duration, info.bytes);
    // worst case output (never assume it is smaller than the source) + the live copy we keep during a swap + the reserve
    const need = Math.max(est.worstCaseBytes, info.bytes * 0.5) * 1.1 + config.limits.reserveFreeBytes;
    if (freeBytes(dirs.media) < need) throw new Error(`Not enough free disk space to encode (about ${(need / 1024 ** 3).toFixed(1)} GB needed). Free some space and press Re-process.`);

    setMovie(movieId, { encode_state: 'processing', progress: 0, error: null, duration_sec: info.duration, source_bytes: info.bytes });
    setUpload(uploadId, 'processing');
    fs.mkdirSync(tmpOut, { recursive: true });

    const ffArgs = ffmpegArgs(src, tmpOut);
    await new Promise((resolve, reject) => {
      // argument array, no shell: no value from a request or filename is ever interpreted by a shell
      const ff = niceBin && config.encode.nice ? spawn(niceBin, ['-n', '10', 'ffmpeg', ...ffArgs]) : spawn('ffmpeg', ffArgs);
      const handle = { child: ff, cancelled: false, timedOut: false };
      running.set(movieId, handle);
      const timer = setTimeout(() => { handle.timedOut = true; ff.kill('SIGKILL'); }, config.encode.timeoutHours * 3600_000);
      const done = (fn) => (arg) => { clearTimeout(timer); running.delete(movieId); fn(arg); };
      let last = 0, tail = '';
      ff.stdout.on('data', (d) => {
        const m = /out_time_us=(\d+)/.exec(d.toString());
        if (m && Date.now() - last > 2000) { last = Date.now(); setMovie(movieId, { progress: Math.min(99, (Number(m[1]) / 1e6 / info.duration) * 100) }); }
      });
      ff.stderr.on('data', (d) => (tail = (tail + d).slice(-600)));
      ff.on('error', done(reject));
      ff.on('close', done((code) => {
        if (handle.cancelled) return reject(new Error('Cancelled by an administrator.'));
        if (handle.timedOut) return reject(new Error(`Encoding exceeded the ${config.encode.timeoutHours} hour limit and was stopped.`));
        return code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + tail.trim()));
      }));
    });

    const v = await validateOutput(tmpOut, info.duration);
    if (!v.ok) throw new Error('Output failed validation: ' + v.error);

    // Publish: swap the validated directory in. A previous good version is only removed after the swap succeeded.
    const live = hlsDir(movieId), old = `${live}.old-${randomId(4)}`;
    if (fs.existsSync(live)) fs.renameSync(live, old);
    fs.renameSync(tmpOut, live);
    fs.rmSync(old, { recursive: true, force: true });

    const seconds = (Date.now() - started) / 1000;
    setMovie(movieId, { status: 'ready', encode_state: 'idle', validated: 1, progress: 100, error: null, encode_seconds: seconds, output_bytes: v.bytes, segments: v.segments });
    setUpload(uploadId, 'completed');
    log('info', 'encode.ready', { movie: movieId, segments: v.segments, output_mb: Math.round(v.bytes / 1024 ** 2), seconds: Math.round(seconds), speed_x: Number((info.duration / seconds).toFixed(2)) });
  } catch (e) {
    failJob(e.message);
  }
}

function pump() {
  while (active < config.encode.concurrency && queue.length) {
    const job = queue.shift();
    active++;
    runJob(job).finally(() => { active--; pump(); });
  }
}

/** Stops a running encode (SIGKILL on the ffmpeg child) or removes a queued one. Originals and any live output are untouched. */
export function cancelEncode(movieId) {
  const h = running.get(movieId);
  if (h) { h.cancelled = true; h.child.kill('SIGKILL'); return 'running'; }
  const i = queue.findIndex((j) => j.movieId === movieId);
  if (i >= 0) {
    const [job] = queue.splice(i, 1);
    setMovie(movieId, { encode_state: 'failed', error: 'Cancelled by an administrator.' });
    setUpload(job.uploadId, 'failed', 'Cancelled by an administrator.');
    return 'queued';
  }
  return null;
}

/** ffmpeg and ffprobe must exist for the SERVICE user, not just for an interactive shell. */
export function checkFfmpeg() {
  const v = (bin) => { const r = spawnSync(bin, ['-version'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split('\n')[0] : null; };
  const ffmpeg = v('ffmpeg'), ffprobe = v('ffprobe');
  return { ok: !!(ffmpeg && ffprobe), ffmpeg, ffprobe };
}

export function enqueueTranscode(movieId, src, uploadId = null) {
  setMovie(movieId, { encode_state: 'queued', progress: 0, error: null, source_file: src });
  setUpload(uploadId, 'queued');
  queue.push({ movieId, src, uploadId });
  pump();
}

/**
 * A hard crash of the Node process (OOM kill, power loss followed by manual start) can leave this app's own ffmpeg running
 * with nothing watching it. Under systemd the control-group kill normally prevents that; this is the application-level
 * safety net: stop any ffmpeg whose output directory is inside MEDIA_DIR. Linux only (/proc); best effort.
 */
export function killOrphanedEncoders() {
  let killed = 0;
  try {
    for (const pid of fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
      let cmd; try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0'); } catch { continue; }
      if (path.basename(cmd[0] || '') === 'ffmpeg' && cmd.includes('-hls_segment_filename') && cmd.some((a) => a.startsWith(dirs.media + path.sep))) {
        try { process.kill(Number(pid), 'SIGKILL'); killed++; } catch { /* already gone or not ours */ }
      }
    }
  } catch { /* no /proc */ }
  if (killed) log('warn', 'encode.orphans_killed', { count: killed });
  return killed;
}

/** After a restart nothing is encoding. Mark interrupted jobs failed (originals untouched) and remove half-written output. */
export function recoverInterrupted() {
  killOrphanedEncoders();
  db.prepare("UPDATE movies SET encode_state = 'failed', error = 'Interrupted by a server restart. Press Re-process.' WHERE encode_state IN ('queued', 'processing')").run();
  db.prepare("UPDATE uploads SET status = 'failed', error = 'Interrupted by a server restart.', updated_at = datetime('now') WHERE status IN ('queued', 'processing')").run();
  for (const name of fs.readdirSync(dirs.media)) if (/\.(tmp|old)-/.test(name)) fs.rmSync(path.join(dirs.media, name), { recursive: true, force: true });
}

/** Partial uploads are resumable, but not forever. */
export function cleanupStaleUploads() {
  const cutoff = Date.now() - config.limits.staleUploadDays * 86400_000;
  const stale = db.prepare("SELECT id, path FROM uploads WHERE status = 'uploading' AND updated_at < ?").all(new Date(cutoff).toISOString().replace('T', ' ').slice(0, 19));
  for (const u of stale) {
    if (u.path?.startsWith(dirs.tmp)) fs.rmSync(u.path, { force: true });
    db.prepare("UPDATE uploads SET status = 'failed', error = 'Abandoned upload removed.' WHERE id = ?").run(u.id);
  }
  const known = new Set(db.prepare("SELECT id FROM uploads WHERE status = 'uploading'").all().map((u) => `${u.id}.part`));
  for (const f of fs.readdirSync(dirs.tmp)) {
    const p = path.join(dirs.tmp, f);
    if (!known.has(f) && Date.now() - fs.statSync(p).mtimeMs > 86400_000) fs.rmSync(p, { force: true });   // orphan with no database record
  }
}
