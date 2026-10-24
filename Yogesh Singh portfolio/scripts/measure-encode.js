// Measures the REAL encode: wall time, speed (x realtime), output vs source size, and ffmpeg's CPU and peak memory.
//   node scripts/measure-encode.js /path/to/film.mp4        (does not touch the database or any published film)
// Run it on the VPS with your actual film to get real numbers instead of estimates.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegArgs, probe, validateOutput } from '../server/transcode.js';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('Usage: node scripts/measure-encode.js <video file>'); process.exit(1); }
const info = await probe(src);
const out = fs.mkdtempSync(path.join(process.env.MEASURE_TMP || os.tmpdir(), 'yp-measure-'));
const started = Date.now();
const ff = spawn('ffmpeg', ffmpegArgs(src, out), { stdio: ['ignore', 'ignore', 'ignore'] });

const clk = 100; let peakKb = 0, cpuTicks = 0;
const timer = setInterval(() => {
  try {
    const st = fs.readFileSync(`/proc/${ff.pid}/status`, 'utf8');
    peakKb = Math.max(peakKb, Number(/VmHWM:\s+(\d+)/.exec(st)?.[1] || 0));
    const f = fs.readFileSync(`/proc/${ff.pid}/stat`, 'utf8').split(') ')[1].split(' ');
    cpuTicks = Number(f[11]) + Number(f[12]);        // utime + stime
  } catch { /* process finished */ }
}, 200);
const code = await new Promise((r) => ff.on('close', r));
clearInterval(timer);
const secs = (Date.now() - started) / 1000;
const bytes = (d) => fs.readdirSync(d).reduce((a, f) => a + fs.statSync(path.join(d, f)).size, 0);
const outBytes = bytes(out);
const v = await validateOutput(out, info.duration);
const srcBytes = fs.statSync(src).size;
const r = {
  ok: code === 0 && v.ok, validation: v.ok ? 'passed' : v.error,
  source: { seconds: Math.round(info.duration), resolution: `${info.width}x${info.height}`, mb: Math.round(srcBytes / 1048576), mbps: +((srcBytes * 8) / info.duration / 1e6).toFixed(2) },
  output: { mb: Math.round(outBytes / 1048576), mbps: +((outBytes * 8) / info.duration / 1e6).toFixed(2), segments: v.segments, vs_source: +(outBytes / srcBytes).toFixed(3) },
  encode: { wall_seconds: +secs.toFixed(1), speed_x_realtime: +(info.duration / secs).toFixed(2), cpu_seconds: +(cpuTicks / clk).toFixed(1), avg_cores_busy: +(cpuTicks / clk / secs).toFixed(2), peak_rss_mb: Math.round(peakKb / 1024) },
  machine: { cpus: os.cpus().length, total_ram_mb: Math.round(os.totalmem() / 1048576) },
  projection_for_2h30m: { hours_at_this_speed: +((9000 / (info.duration / secs)) / 3600).toFixed(2), output_gb_at_this_bitrate: +(((outBytes / info.duration) * 9000) / 1024 ** 3).toFixed(2) },
};
console.log(JSON.stringify(r, null, 2));
if (process.env.KEEP_OUT) console.error('output kept in', out); else fs.rmSync(out, { recursive: true, force: true });
process.exit(r.ok ? 0 : 1);
