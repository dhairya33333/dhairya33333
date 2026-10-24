import { api, $, $$, rupees, runtime, getUser, mountNav, initMotion, loadScript } from './common.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());
const video = $('#video');
let movie, user, mode, playback, hls;

const say = (text, ok) => { const m = $('#pay-msg'); m.textContent = text; m.className = 'msg' + (ok ? ' ok' : ''); };
const state = (text, { retry } = {}) => {
  const el = $('#pstate');
  el.hidden = !text;
  el.innerHTML = '';
  if (!text) return;
  el.append(Object.assign(document.createElement('div'), { textContent: text }));
  if (retry) { const b = Object.assign(document.createElement('button'), { className: 'btn s', textContent: 'Try again' }); b.onclick = start; el.firstChild.append(document.createElement('br'), b); }
};

const spoken = (sec) => (sec < 90 ? `${sec} seconds` : `${Math.round(sec / 60)} minutes`);
const posKey = () => `yp-pos-${movie.id}`;
const savedPos = () => Number(localStorage.getItem(posKey()) || 0);
const savePos = (n) => { try { localStorage.setItem(posKey(), String(Math.floor(n))); } catch { /* private mode */ } };

function showPaywall() {
  if (playback?.mode === 'full') return;
  $('#paywall').classList.add('show');
  $('#paywall-buy').focus({ preventScroll: true });
}

function attach(src, resumeAt) {
  hls?.destroy(); hls = null;
  const begin = () => { if (resumeAt > 1) video.currentTime = resumeAt; state(''); };
  if (window.Hls?.isSupported()) {
    hls = new Hls({ maxBufferLength: 30, enableWorker: true });
    hls.loadSource(src); hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, begin);
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      const code = d.response?.code;
      if (code === 401 || code === 403) { playback = { ...playback, mode: 'preview' }; state(''); showPaywall(); }   // access changed (e.g. refund, signed out)
      else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) { state('Network problem while loading the film.', { retry: true }); hls.destroy(); }
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else state('This video could not be played.', { retry: true });
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.addEventListener('loadedmetadata', begin, { once: true });
    video.addEventListener('error', () => state('This video could not be played.', { retry: true }), { once: true });
  } else {
    state('Your browser cannot play this video. Please try a current version of Chrome, Safari, Edge or Firefox.');
  }
}

function renderInfo() {
  document.title = `${movie.title} — Y. P. Singh`;
  $('#title').textContent = movie.title;
  $('#tagline').textContent = movie.tagline || '';
  $('#desc').textContent = movie.description || '';
  $('#facts').innerHTML = '';
  for (const f of [movie.duration_sec ? runtime(movie.duration_sec) : '', movie.year || '', `${rupees(movie.price_paise)} one-time`]) if (f) $('#facts').append(Object.assign(document.createElement('span'), { className: 'chip', textContent: f }));
  const owns = playback.mode === 'full';
  const freeLen = spoken(playback.previewSeconds);
  $('#badge').textContent = owns ? 'Full film' : 'Free preview';
  $('#preview-note').hidden = false;
  $('#preview-note').textContent = owns
    ? 'You own this film. Your place is saved on this device.'
    : playback.url
      ? `You are watching the free preview: the first ${freeLen}. When it ends, a one-time payment of ${rupees(movie.price_paise)} unlocks the rest of the film.`
      : `This film has no free preview. A one-time payment of ${rupees(movie.price_paise)} unlocks it.`;
  $('#buy').innerHTML = owns
    ? `<span class="owned">✓ You own this film</span><p style="color:var(--muted);margin:12px 0 0">Enjoy the full film. Your place is saved automatically.</p>`
    : `<span class="price serif">${rupees(movie.price_paise)}</span>
       <ul><li>One-time payment, no subscription</li><li>First ${freeLen} always free</li><li>Watch on any device</li><li>Pick up where you left off</li></ul>
       <button class="btn gold" id="buy-btn">Unlock full film <span class="arrow">→</span></button>`;
  $('#buy-btn')?.addEventListener('click', unlock);
}

let lastFocus;
function openModal() { lastFocus = document.activeElement; $('#modal').classList.add('open'); ($('#phone-field').hidden ? $('#pay-go') : $('#phone')).focus(); }
function closeModal() { $('#modal').classList.remove('open'); lastFocus?.focus?.(); }

function unlock() {
  if (!user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + '#unlock')}`; return; }
  const needsPhone = mode === 'cashfree' || mode === 'demo';
  $('#pay-amt').textContent = rupees(movie.price_paise);
  $('#demo-note').hidden = mode !== 'demo';
  $('#phone-field').hidden = !needsPhone;
  $('#gateway-copy').textContent = mode === 'demo' ? 'Demo checkout (no real payment).' : 'Secure payment. UPI, cards and net banking accepted.';
  $('#phone').value = user.phone || '';
  $('#pay-go').disabled = false; $('#agree').checked = false;
  say('');
  openModal();
}

async function confirmPayment(orderId) {
  state('Confirming your payment…');
  location.href = `/payment-return.html?order_id=${encodeURIComponent(orderId)}`;
}

async function pay() {
  const btn = $('#pay-go');
  say('');
  if (!$('#agree').checked) { say('Please tick the box to accept the Terms, Privacy Policy and Refund Policy.'); $('#agree').focus(); return; }
  btn.disabled = true;
  try {
    const o = await api('/payments/checkout', { method: 'POST', body: { movieId: movie.id, phone: $('#phone').value, agree: true } });
    if (o.mode === 'demo') {
      await api('/payments/demo/complete', { method: 'POST', body: { orderId: o.orderId } });
      location.hash = ''; location.reload(); return;
    }
    if (o.provider === 'razorpay') {
      await loadScript('https://checkout.razorpay.com/v1/checkout.js');
      const rzp = new window.Razorpay({
        key: o.keyId, order_id: o.razorpayOrderId, amount: o.amount, currency: o.currency, name: 'Y. P. Singh', description: movie.title,
        prefill: o.prefill, theme: { color: '#9a7430' },
        handler: async (resp) => {          // success callback: only a hint, the server verifies signature + payment
          closeModal(); state('Confirming your payment…');
          try {
            const v = await api('/payments/razorpay/verify', { method: 'POST', body: resp });
            if (v.status === 'PAID') { location.hash = ''; location.reload(); } else confirmPayment(o.orderId);
          } catch { confirmPayment(o.orderId); }
        },
        modal: { ondismiss: () => { btn.disabled = false; say('Payment window closed. You have not been charged.'); api('/payments/cancel', { method: 'POST', body: { orderId: o.orderId } }).catch(() => {}); } },
      });
      rzp.on('payment.failed', (r) => { btn.disabled = false; say(r?.error?.description ? `${r.error.description} You can try again.` : 'The payment failed. You can try again.'); });
      rzp.open();
      return;
    }
    if (o.provider === 'cashfree') {
      await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
      await window.Cashfree({ mode: o.sdkMode }).checkout({ paymentSessionId: o.paymentSessionId, redirectTarget: '_self' });
      return;
    }
    throw new Error('Unknown payment method.');
  } catch (e) {
    say(e.message || 'Something went wrong. You have not been charged.'); btn.disabled = false;
  }
}

async function start() {
  state('Loading film…');
  try { playback = await api(`/movies/${encodeURIComponent(slug)}/playback`); }
  catch { state('The film could not be loaded.', { retry: true }); return; }
  renderInfo();
  if (!playback.url) { state(''); showPaywall(); return; }
  const cap = playback.mode === 'preview' ? Math.max(0, playback.previewSeconds - 5) : Infinity;
  attach(playback.url, Math.min(savedPos(), cap));
}

async function boot() {
  user = await getUser();
  mountNav(user);
  let data;
  try { data = await api(`/movies/${encodeURIComponent(slug)}`); } catch { location.replace('/404.html'); return; }
  movie = data.movie; mode = data.paymentsMode;
  await loadScript('/vendor/hls.js').catch(() => {});
  await start();
  if (playback.mode === 'preview') {
    video.addEventListener('ended', () => { savePos(playback.previewSeconds); showPaywall(); });
    $('#paywall-buy').addEventListener('click', unlock);
  }
  let last = 0;
  video.addEventListener('timeupdate', () => { if (Math.abs(video.currentTime - last) > 5) { last = video.currentTime; savePos(last); } });
  video.addEventListener('waiting', () => { if (!video.paused) state('Buffering…'); });
  for (const ev of ['playing', 'canplay']) video.addEventListener(ev, () => state(''));
  video.addEventListener('contextmenu', (e) => e.preventDefault());

  $('#pay-go').addEventListener('click', pay);
  $('#modal-x').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  addEventListener('keydown', (e) => {
    if (!$('#modal').classList.contains('open')) return;
    if (e.key === 'Escape') return closeModal();
    if (e.key !== 'Tab') return;                                       // keep keyboard focus inside the open dialog
    const f = $$('button, input, a[href]', $('#modal')).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  if (location.hash === '#unlock' && playback.mode !== 'full') unlock();
  initMotion();
}
boot();
