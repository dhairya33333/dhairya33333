import { api, $ } from './common.js';

const orderId = new URLSearchParams(location.search).get('order_id');
const done = (title, sub, href, label) => { $('#t').textContent = title; $('#s').textContent = sub; const a = $('#go'); a.href = href; a.textContent = label; a.hidden = false; $('#t').focus(); };

// Nothing in this page's URL is trusted: the backend reports what it has actually recorded for this order.
(async () => {
  if (!orderId) return done('Nothing to confirm', 'We could not find a payment to check.', '/films', 'Browse films');
  for (let i = 0; i < 14; i++) {
    try {
      const r = await api(`/payments/verify?order_id=${encodeURIComponent(orderId)}`);
      if (r.status === 'PAID') return done('Payment confirmed', 'The full film is unlocked. Enjoy.', `/film/${r.slug}`, 'Watch now →');
      if (r.status === 'FAILED') return done('Payment not completed', 'You have not been charged, or any amount debited will be refunded by your bank. You can try again.', `/film/${r.slug}#unlock`, 'Try again');
      if (r.status === 'CANCELLED') return done('Payment cancelled', 'No payment was made.', `/film/${r.slug}`, 'Back to the film');
      if (r.status === 'REFUNDED') return done('This payment was refunded', 'Access to the full film has been removed.', `/film/${r.slug}`, 'Back to the film');
    } catch (e) {
      if (e.status === 401) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
      if (e.status === 404) return done('Order not found', 'This order does not belong to your account.', '/account.html', 'My account');
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  done('Still waiting for your bank', 'If money was debited, access appears automatically once the payment is confirmed, usually within a few minutes. You do not need to pay again.', '/account.html', 'My account');
})();
