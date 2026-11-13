import { esc } from './common.js';

// Small, safe text formatter for owner-edited pages. Everything is HTML-escaped first, then only these shapes are recognised:
//   "## heading"   "- list item"   "> quote line"   blank line = new paragraph   **bold**   [text](https://… or /page)
// Links must start with https://, http:// or a single "/", so nothing like javascript: can be produced.
export function format(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s)]*)\)/g, (_m, label, url) => `<a href="${url}"${/^https?:/.test(url) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`);
  const out = []; let list = [], quote = [];
  const flush = () => {
    if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; }
    if (quote.length) { out.push(`<blockquote>${quote.map((l, i) => (i === quote.length - 1 && quote.length > 1 ? `<cite>${inline(l)}</cite>` : `<p>${inline(l)}</p>`)).join('')}</blockquote>`); quote = []; }
  };
  for (const block of String(text).split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      if (/^##\s+/.test(line)) { flush(); out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); }
      else if (/^-\s+/.test(line)) { if (quote.length) flush(); list.push(line.replace(/^-\s+/, '')); }
      else if (/^>\s?/.test(line)) { if (list.length) flush(); quote.push(line.replace(/^>\s?/, '')); }
      else if (line.trim()) { flush(); out.push(`<p>${inline(line)}</p>`); }
    }
    flush();
  }
  return out.join('');
}
