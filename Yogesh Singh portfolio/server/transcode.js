import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config, dirs } from './config.js';
import { db } from './db.js';

const queue = [];
let running = false;

export const hlsDir = (movieId) => path.join(dirs.media, String(movieId));

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => {
      const n = parseFloat(out);
      code === 0 && n > 0 ? resolve(n) : reject(new Error('Could not read video duration (is it a valid video file?)'));
    });
  });
}

async function run(movieId, src) {
  const set = (fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE movies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), movieId);
  };
  try {
    const duration = await probeDuration(src);
    const out = hlsDir(movieId);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    set({ duration_sec: duration, status: 'processing', progress: 0, error: null });

    const seg = config.hls.segment;
    const args = [
      '-y', '-i', src,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(config.hls.crf),
      '-vf', `scale=-2:'min(${config.hls.height},ih)'`,
      '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-force_key_frames', `expr:gte(t,n_forced*${seg})`, '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-f', 'hls', '-hls_time', String(seg), '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(out, 'seg_%05d.ts'),
      '-progress', 'pipe:1', '-nostats',
      path.join(out, 'index.m3u8'),
    ];
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', args);
      let last = 0, tail = '';
      ff.stdout.on('data', (d) => {
        const m = /out_time_us=(\d+)/.exec(d.toString());
        if (m && Date.now() - last > 2000) {
          last = Date.now();
          set({ progress: Math.min(99, (Number(m[1]) / 1e6 / duration) * 100) });
        }
      });
      ff.stderr.on('data', (d) => (tail = (tail + d).slice(-600)));
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + tail))));
    });
    set({ status: 'ready', progress: 100 });
    console.log(`[transcode] movie ${movieId} ready`);
  } catch (e) {
    console.error('[transcode] failed', e.message);
    set({ status: 'failed', error: String(e.message).slice(0, 500) });
  }
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) { const job = queue.shift(); await run(job.movieId, job.src); }
  running = false;
}

export function enqueueTranscode(movieId, src) {
  db.prepare("UPDATE movies SET status = 'processing', progress = 0, error = NULL, source_file = ? WHERE id = ?").run(src, movieId);
  queue.push({ movieId, src });
  pump();
}

/** After a restart nothing is actually encoding: mark interrupted jobs as failed so admin can retry. */
export function recoverInterrupted() {
  db.prepare("UPDATE movies SET status = 'failed', error = 'Interrupted by a server restart. Press Re-process.' WHERE status = 'processing'").run();
}
