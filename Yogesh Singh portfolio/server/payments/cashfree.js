import crypto from 'node:crypto';
import { config } from '../config.js';

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

export const name = 'cashfree';
export const requiresPhone = true;
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

const toPaise = (rupees) => Math.round(Number(rupees) * 100);

export const fetchPayments = async (orderId) => {
  const list = await call('GET', `/orders/${encodeURIComponent(orderId)}/payments`);
  return Array.isArray(list) ? list : [];
};

/** Authoritative paid data from Cashfree's API: the successful payment with its real amount, currency and id. */
export async function authoritativePayment(order, cfPaymentId = null) {
  const ok = (await fetchPayments(order.order_id)).find((p) => p.payment_status === 'SUCCESS' && (!cfPaymentId || String(p.cf_payment_id) === String(cfPaymentId)));
  return ok ? { paymentId: String(ok.cf_payment_id), amountPaise: toPaise(ok.payment_amount), currency: String(ok.payment_currency || 'INR') } : null;
}

export async function createCheckout({ order, user, phone, siteUrl }) {
  const o = await createOrder({
    orderId: order.order_id, amountPaise: order.amount_paise, user, phone,
    returnUrl: `${siteUrl}/payment-return.html?order_id=${order.order_id}`, notifyUrl: `${siteUrl}/api/payments/webhook`,
  });
  return { providerOrderId: order.order_id, client: { provider: 'cashfree', sdkMode: cf.sdkMode, paymentSessionId: o.payment_session_id, orderId: order.order_id } };
}

export async function reconcile(order) {
  const paid = await authoritativePayment(order);
  if (paid) return { state: 'PAID', ...paid };
  const st = await fetchOrderStatus(order.order_id);
  return { state: st === 'EXPIRED' || st === 'TERMINATED' ? 'FAILED' : 'PENDING' };
}

/** Cashfree amounts are rupees (decimal); everything is converted to integer paise here. */
export function parseWebhook(rawBody) {
  const body = JSON.parse(rawBody);
  const type = String(body.type || '');
  const d = body.data || {};
  const refund = d.refund || null;
  const map = { PAYMENT_SUCCESS_WEBHOOK: 'paid', PAYMENT_FAILED_WEBHOOK: 'failed', REFUND_STATUS_WEBHOOK: refund?.refund_status === 'SUCCESS' ? 'refunded' : 'ignored',
    DISPUTE_CREATED: 'dispute_open', DISPUTE_UPDATED: 'dispute_open' };
  const orderId = d.order?.order_id || refund?.order_id || d.dispute?.order_id || null;
  return {
    eventId: `${type}:${orderId}:${d.payment?.cf_payment_id || refund?.cf_refund_id || refund?.refund_id || d.dispute?.dispute_id || body.event_time || ''}`,
    type: map[type] || 'ignored', raw: type, orderId, paymentId: d.payment?.cf_payment_id != null ? String(d.payment.cf_payment_id) : null,
    refundId: refund ? String(refund.cf_refund_id ?? refund.refund_id ?? '') || null : null,
    refundAmountPaise: refund?.refund_amount != null ? toPaise(refund.refund_amount) : null,
    failure: d.payment?.payment_message || null,
  };
}
