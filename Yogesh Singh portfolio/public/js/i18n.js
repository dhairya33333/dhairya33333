// English / Hindi. English is the default. The choice is remembered on this device.
//  - Editable content (biography, taglines, film text...) has an optional Hindi version saved by the site owner: pick() uses it when
//    present and quietly falls back to English when it is empty.
//  - Interface text (buttons, labels, messages) is translated from a built-in dictionary (i18n-hi.js), loaded only for Hindi readers.
//  - Switching language reloads the page, so everything is drawn again in the chosen language.
export const isHi = (() => { try { return localStorage.getItem('yp-lang') === 'hi' && !location.pathname.startsWith('/admin'); } catch { return false; } })();
export const pick = (o, k) => (isHi && String(o?.[`${k}_hi`] ?? '').trim() ? o[`${k}_hi`] : o?.[k]);
const over = (o, keys) => { for (const k of keys) { const v = String(o?.[`${k}_hi`] ?? '').trim(); if (v) o[k] = v; } return o; };
/** Applied to API answers in Hindi mode: every field with a non-empty Hindi version replaces the English one. */
export function localise(path, data) {
  if (!isHi || !data) return data;
  if (path === '/site') {
    for (const k of Object.keys(data.settings || {})) if (!k.endsWith('_hi')) over(data.settings, [k]);
    data.movies?.forEach((m) => over(m, ['title', 'tagline', 'description'])); data.works?.forEach((w) => over(w, ['title', 'subtitle']));
  } else if (/^\/movies\/[^/]+$/.test(path)) over(data.movie, ['title', 'tagline', 'description']);
  else if (path === '/gallery' || path === '/social') over(data, ['title', 'intro']);
  return data;
}
export function setLang(l) { try { localStorage.setItem('yp-lang', l); } catch { /* private mode: lasts until reload */ } location.reload(); }

if (isHi) {
  document.documentElement.lang = 'hi';
  const f = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@300;400;500&family=Noto+Serif+Devanagari:wght@400;500&display=swap' });
  document.head.append(f);
}

export function mountLangToggle() {
  const slot = document.querySelector('.nav-links');
  if (!slot || slot.querySelector('.lang-btn')) return;
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'lang-btn', textContent: isHi ? 'EN' : 'हिं' });
  b.setAttribute('aria-label', isHi ? 'Switch to English' : 'हिन्दी में देखें'); b.title = b.getAttribute('aria-label'); b.lang = isHi ? 'en' : 'hi';
  b.addEventListener('click', () => setLang(isHi ? 'en' : 'hi'));
  slot.insertBefore(b, slot.querySelector('#nav-auth'));
}

const SKIP = 'script, style, textarea, code, pre, [data-no-i18n]';
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
export async function initI18n() {
  mountLangToggle();
  if (!isHi || initI18n.done) return; initI18n.done = true;
  const { DICT, PATTERNS } = await import('./i18n-hi.js');
  const tr = (s) => {
    const core = s.trim(); if (!core) return s;
    const hit = DICT[core] ?? PATTERNS.reduce((acc, [re, fn]) => acc ?? (re.test(core) ? core.replace(re, fn) : undefined), undefined);
    return hit === undefined ? s : s.replace(core, hit);
  };
  const walk = (root) => {
    if (root.nodeType === 3) { if (!root.parentElement?.closest(SKIP)) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; } return; }
    if (root.nodeType !== 1 || root.matches?.(SKIP)) return;
    if (root.dataset?.hi) {                                   // a heading written out whole in Hindi: *word* becomes the emphasised part
      const parts = root.dataset.hi.split('*'); root.replaceChildren(...parts.map((t, i) => { if (i % 2) { const e = document.createElement('em'); e.textContent = t; return e; } return document.createTextNode(t); })); delete root.dataset.hi; return;
    }
    for (const a of ATTRS) if (root.hasAttribute?.(a)) { const v = tr(root.getAttribute(a)); if (v !== root.getAttribute(a)) root.setAttribute(a, v); }
    root.childNodes.forEach(walk);
  };
  let busy = false;
  const run = (nodes) => { busy = true; try { nodes.forEach(walk); } finally { busy = false; } };
  run([document.body]);
  new MutationObserver((muts) => {
    if (busy) return;
    const nodes = [];
    for (const m of muts) { if (m.type === 'characterData') nodes.push(m.target); else if (m.type === 'attributes') nodes.push(m.target); else m.addedNodes.forEach((n) => nodes.push(n)); }
    run(nodes);
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
initI18n();
