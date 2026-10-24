import crypto from 'node:crypto';
import { config } from './config.js';

const cf = config.cashfree;

async function call(method, path, body) {
  const res = await fetch(cf.base + path, {
    method,
    headers: {
      'x-client-id': cf.appId,
      'x-client-secret': cf.secret,
      'x-api-version': cf.version,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cashfree ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

export const createOrder = ({ orderId, amountPaise, user, phone, returnUrl, notifyUrl }) =>
  call('POST', '/orders', {
    order_id: orderId,
    order_amount: Number((amountPaise / 100).toFixed(2)),
    order_currency: 'INR',
    customer_details: {
      customer_id: `u${user.id}`,
      customer_name: user.name,
      customer_email: user.email,
      customer_phone: phone,
    },
    order_meta: { return_url: returnUrl, notify_url: notifyUrl },
    order_note: 'Film access',
  });

/** Source of truth: ask Cashfree, never trust the browser. Returns PAID | ACTIVE | EXPIRED ... */
export const fetchOrderStatus = async (orderId) => (await call('GET', `/orders/${encodeURIComponent(orderId)}`)).order_status;

/** Webhook signature = base64(HMAC_SHA256(timestamp + rawBody, secret)) */
export function verifyWebhook(rawBody, signature, timestamp) {
  if (!signature || !timestamp) return false;
  const expected = crypto.createHmac('sha256', cf.secret).update(timestamp + rawBody).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
