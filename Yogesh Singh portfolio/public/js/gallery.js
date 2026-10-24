import { api, $, esc, initMotion } from './common.js';
import { mountChrome } from './layout.js';

const site = await api('/site');
await mountChrome({ active: '/gallery', settings: site.settings });
const g = await api('/gallery');
$('#title').textContent = g.title || 'Gallery'; $('#intro').textContent = g.intro || '';
document.title = `${g.title || 'Gallery'} — ${site.settings.hero_name}`;
const items = g.items;
if (!items.length) $('#empty').hidden = false;
$('#grid').innerHTML = items.map((p, i) => `<button class="gitem" data-i="${i}" data-reveal style="--i:${i % 8};${p.w && p.h ? `aspect-ratio:${p.w}/${p.h}` : ''}" aria-label="${esc(p.caption || 'Open photo ' + (i + 1))}"><img src="${esc(p.thumb)}" alt="${esc(p.caption || '')}" loading="lazy" decoding="async"${p.w ? ` width="${p.w}" height="${p.h}"` : ''}></button>`).join('');

const box = $('#gbox'); let cur = 0, opener = null;
function show(i) {
  cur = (i + items.length) % items.length; const p = items[cur];
  $('#gimg').src = p.src; $('#gimg').alt = p.caption || ''; $('#gcap').textContent = p.caption || '';
  $('#gprev').hidden = $('#gnext').hidden = items.length < 2;
}
function open(i) { opener = document.activeElement; show(i); box.hidden = false; document.body.style.overflow = 'hidden'; requestAnimationFrame(() => box.classList.add('on')); $('.gbox-x').focus(); }
function close() { box.classList.remove('on'); box.hidden = true; document.body.style.overflow = ''; opener?.focus?.(); }
$('#grid').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) open(Number(b.dataset.i)); });
box.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === box) close(); });
$('#gprev').onclick = () => show(cur - 1); $('#gnext').onclick = () => show(cur + 1);
addEventListener('keydown', (e) => { if (box.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
let sx = 0; box.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
box.addEventListener('touchend', (e) => { const d = e.changedTouches[0].clientX - sx; if (Math.abs(d) > 50) show(cur + (d < 0 ? 1 : -1)); });
initMotion();
