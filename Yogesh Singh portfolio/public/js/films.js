import { api, $, esc, rupees, runtime, minutes, getUser, mountNav, initMotion } from './common.js';

mountNav(await getUser());
try {
  const { movies } = await api('/site');
  $('#grid').innerHTML = movies.length ? movies.map((m, i) => `
    <a class="fcard" href="/film/${esc(m.slug)}" data-reveal style="--i:${i}">
      <div class="poster">${m.poster ? `<img src="${esc(m.poster)}" alt="${esc(m.title)} poster" loading="lazy">` : `<div class="ph">${esc(m.title)}</div>`}<span class="shine"></span></div>
      <h3>${esc(m.title)}</h3>
      <p>${esc(m.tagline || '')}</p>
      <div class="chips" style="margin:10px 0 0">
        ${m.duration_sec ? `<span class="chip">${runtime(m.duration_sec)}</span>` : ''}
        ${m.preview_sec ? `<span class="chip free">First ${minutes(m.preview_sec)} min free</span>` : ''}
        <span class="chip">${rupees(m.price_paise)}</span>
      </div>
    </a>`).join('') : '<div class="empty">No films are published yet. Please check back soon.</div>';
} catch (e) {
  $('#grid').innerHTML = `<div class="empty">The library could not be loaded. <a class="link" href="">Try again</a></div>`;
}
initMotion();
