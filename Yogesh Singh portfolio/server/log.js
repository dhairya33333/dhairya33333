// Structured, redacted logging. Secrets, tokens, signatures and filesystem paths never reach the log.
import { dirs } from './config.js';

const SENSITIVE_KEY = /pass|token|secret|signature|authorization|cookie|credential|key|session/i;
const PATHS = Object.entries({ source: dirs.source, media: dirs.media, incoming: dirs.incoming, tmp: dirs.tmp, backups: dirs.backups, uploads: dirs.uploads, data: dirs.data })
  .sort((a, b) => b[1].length - a[1].length);   // longest path first so nested dirs are replaced correctly

/** Replace server directory paths in free text (ffmpeg errors, stack lines) with neutral tags. */
export function scrub(text) {
  let s = String(text ?? '');
  for (const [name, p] of PATHS) if (p.length > 1) s = s.split(p).join(`<${name}>`);
  return s.replace(/\/(?:home|root|var|srv|opt|tmp|etc)\/[^\s'"]+/g, '<path>');
}

function clean(v, depth = 0) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return scrub(v).slice(0, 500);
  if (depth > 2) return '[deep]';
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : clean(x, depth + 1)]));
  return String(v);
}

let sink = process.env.NODE_ENV === 'test' ? () => {} : (line) => console.log(line);
export const setLogSink = (fn) => { sink = fn; };

export function log(level, event, fields = {}) {
  sink(JSON.stringify({ t: new Date().toISOString(), level, event, ...clean(fields) }));
}
