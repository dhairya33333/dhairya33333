import { api, $ } from './common.js';

const orderId = new URLSearchParams(location.search).get('order_id');
const done = (title, sub, href, label) => { $('#t').textContent = title; $('#s').textContent = sub; const a = $('#go'); a.href = href; a.textContent = label; a.hidden = false; };

(async () => {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await api(`/payments/verify?order_id=${encodeURIComponent(orderId)}`);
      if (r.status === 'PAID') { done('Payment successful', 'The full film is unlocked. Enjoy.', `/film/${r.slug}`, 'Watch now →'); return; }
      if (r.status === 'FAILED') { done('Payment not completed', 'You have not been charged. You can try again.', `/film/${r.slug}`, 'Back to the film'); return; }
    } catch (e) {
      if (e.status === 401) { location.href = '/login.html'; return; }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  done('Still processing', 'If money was debited, access appears automatically within a few minutes.', '/account.html', 'My account');
})();
