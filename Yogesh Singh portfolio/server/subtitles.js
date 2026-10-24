// Subtitle files: accepts SRT or WebVTT, validates, and stores a clean WebVTT. The free preview is enforced here too:
// anyone who has not bought the film gets only the cues that fall inside the free window, so subtitles never leak the paid story.
const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const toSec = (m) => (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
const stamp = (s) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };

export const LIMITS = { bytes: 2 * 1024 * 1024, cues: 20000 };

/** Returns [{start, end, text}] or throws Error with a message fit to show the admin. */
export function parseSubtitles(raw) {
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.includes('\u0000')) throw new Error('That does not look like a subtitle text file.');
  const blocks = text.split(/\n{2,}/), cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i, a) => !(i === 0 && /^\d+$/.test(l.trim()) && a.length > 1));   // optional SRT cue number
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;                                                       // WEBVTT header, NOTE blocks, etc.
    const [a, b] = lines[idx].split('-->'); const ma = TIME.exec(a), mb = TIME.exec(b || '');
    if (!ma || !mb) continue;
    const start = toSec(ma), end = toSec(mb);
    const body = lines.slice(idx + 1).join('\n')
      .replace(/<(?!\/?(?:i|b|u)>)[^>]*>/gi, '')                                  // keep only <i> <b> <u>
      .replace(/\{\\[^}]*\}/g, '').trim();
    if (!body || end <= start) continue;
    cues.push({ start, end, text: body.replace(/-->/g, '→') });
    if (cues.length > LIMITS.cues) throw new Error('This subtitle file has too many lines.');
  }
  if (!cues.length) throw new Error('No subtitles were found in that file. Use an .srt or .vtt file.');
  return cues.sort((x, y) => x.start - y.start);
}

export const toVtt = (cues) => 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n') + '\n';

/** Only what is shown inside the free window; a cue that straddles the end is cut at it. */
export function trimToPreview(cues, previewSec) {
  return cues.filter((c) => c.start < previewSec).map((c) => ({ ...c, end: Math.min(c.end, previewSec) }));
}
