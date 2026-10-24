import { api, $, esc, rupees, getUser, mountNav, initMotion } from './common.js';

const slug = location.pathname.split('/').filter(Boolean).pop();
const video = $('#video');
let movie, owns = false, user, mode;

const loadScript = (src) => new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
});

function attach(src, resumeAt = 0) {
  const start = () => { if (resumeAt > 1) video.currentTime = resumeAt; };
  if (window.Hls?.isSupported()) {
    const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
    hls.loadSource(src); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, start);
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (d.fatal && d.response?.code === 403) showPaywall();
      else if (d.fatal && d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (d.fatal && d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src; video.addEventListener('loadedmetadata', start, { once: true });
  } else {
    $('#badge').textContent = 'Your browser cannot play this video';
  }
}

const posKey = () => `yp-pos-${movie.id}`;
const savedPos = () => Number(localStorage.getItem(posKey()) || 0);

function showPaywall() { $('#paywall').classList.add('show'); }

function renderInfo() {
  document.title = `${movie.title} — Yogesh Singh`;
  $('#title').textContent = movie.title;
  $('#tagline').textContent = movie.tagline || '';
  $('#desc').textContent = movie.description || '';
  const free = Math.round(movie.preview_sec / 60);
  $('#buy').innerHTML = owns
    ? `<span class="owned">✓ You own this film</span><p style="color:var(--muted);margin:12px 0 0">Enjoy the full film. Your place is saved automatically.</p>`
    : `<span class="price serif">${rupees(movie.price_paise)}</span>
       <ul><li>Full film, start to finish</li><li>First ${free} minutes always free</li><li>Watch on any device</li><li>Pick up where you left off</li></ul>
       <button class="btn gold" id="buy-btn">Unlock full film <span class="arrow">→</span></button>`;
  $('#buy-btn')?.addEventListener('click', unlock);
}

function unlock() {
  if (!user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + '#unlock')}`; return; }
  $('#pay-amt').textContent = rupees(movie.price_paise);
  $('#demo-note').hidden = mode !== 'demo';
  $('#phone').value = user.phone || '';
  $('#pay-msg').textContent = '';
  $('#modal').classList.add('open');
  $('#phone').focus();
}

async function pay() {
  const btn = $('#pay-go'), msg = $('#pay-msg');
  msg.className = 'msg'; msg.textContent = '';
  btn.disabled = true;
  try {
    const o = await api('/payments/checkout', { method: 'POST', body: { movieId: movie.id, phone: $('#phone').value } });
    if (o.mode === 'demo') {
      await api('/payments/demo/complete', { method: 'POST', body: { orderId: o.orderId } });
      location.hash = ''; location.reload();
      return;
    }
    await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
    const cf = Cashfree({ mode: o.sdkMode });
    await cf.checkout({ paymentSessionId: o.paymentSessionId, redirectTarget: '_self' });
  } catch (e) {
    msg.textContent = e.message; btn.disabled = false;
  }
}

async function boot() {
  user = await getUser();
  mountNav(user);
  let data;
  try { data = await api(`/movies/${encodeURIComponent(slug)}`); } catch { location.replace('/404.html'); return; }
  ({ movie, owns } = data); mode = data.paymentsMode;
  renderInfo();

  await loadScript('/vendor/hls.js').catch(() => {});
  if (owns) {
    $('#badge').textContent = 'Full film';
    attach(`/media/${movie.id}/full.m3u8`, savedPos());
  } else {
    attach(`/media/${movie.id}/preview.m3u8`, Math.min(savedPos(), movie.preview_sec - 5));
    video.addEventListener('ended', () => { localStorage.setItem(posKey(), movie.preview_sec); showPaywall(); });
    $('#paywall-buy').addEventListener('click', unlock);
  }
  let last = 0;
  video.addEventListener('timeupdate', () => {
    if (video.currentTime - last > 5 || video.currentTime < last) { last = video.currentTime; localStorage.setItem(posKey(), Math.floor(last)); }
  });

  $('#pay-go').addEventListener('click', pay);
  $('#modal-x').addEventListener('click', () => $('#modal').classList.remove('open'));
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('open'); });
  if (location.hash === '#unlock' && !owns) unlock();
  initMotion();
}
boot();
document.getElementById('video').addEventListener('contextmenu', (e) => e.preventDefault());
