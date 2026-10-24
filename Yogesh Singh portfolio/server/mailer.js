// Outgoing email: contact notifications, purchase receipts, password-reset links.
// Email is optional. With no SMTP_HOST set every function here quietly does nothing, and the site works exactly as before.
// Sending never blocks or breaks the request that triggered it: failures are logged (without addresses or secrets) and swallowed.
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db, getSetting } from './db.js';
import { log, scrub } from './log.js';

let transport = null, override = null;
export const mailConfigured = () => Boolean(override || config.mail.host);
/** Tests inject a fake transport ({ sendMail }); pass null to go back to SMTP. */
export function setTransport(t) { override = t; transport = null; }
function getTransport() {
  if (override) return override;
  if (!transport) {
    const m = config.mail;
    transport = nodemailer.createTransport({
      host: m.host, port: m.port, secure: m.port === 465, auth: m.user ? { user: m.user, pass: m.pass } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    });
  }
  return transport;
}

const strip = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();                 // header values: no line breaks, ever (header injection)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siteName = () => getSetting('hero_name') || 'Yogesh Pratap Singh';
const inr = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

/** Where the owner's notifications go: NOTIFY_EMAIL, else the contact email shown on the site. */
export const notifyAddress = () => config.mail.notifyTo || getSetting('contact_email') || '';

export async function sendMail({ to, subject, text, replyTo }) {
  if (!mailConfigured() || !to) return { ok: false, skipped: true };
  const html = `<div style="font:15px/1.6 Georgia,serif;color:#1c1b19;max-width:560px">${esc(text).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</div>`;
  try {
    await getTransport().sendMail({ from: config.mail.from, to: strip(to), subject: strip(subject).slice(0, 200), text, html, ...(replyTo ? { replyTo: strip(replyTo) } : {}) });
    log('info', 'mail.sent', { subject: strip(subject).slice(0, 60) });
    return { ok: true };
  } catch (e) {
    log('warn', 'mail.failed', { reason: scrub(String(e.message || e)).slice(0, 160) });
    return { ok: false, error: 'send_failed' };
  }
}

export function notifyContact(m) {
  const to = notifyAddress(); if (!to) return;
  const lines = [`New message on ${siteName()}'s website`, '', `From: ${m.name} <${m.email}>`, m.phone ? `Phone: ${m.phone}` : '', m.organisation ? `Organisation: ${m.organisation}` : '', `Topic: ${m.topic}`, '', m.message, '', 'You can also read and mark it in Admin → Inbox. Reply to this email to answer the sender.'].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return sendMail({ to, subject: `New message: ${m.topic} — ${m.name}`, text: lines.join('\n'), replyTo: m.email });
}

export function sendReceipt(orderId) {
  const o = db.prepare('SELECT o.*, u.email, u.name AS uname, m.title, m.slug FROM orders o JOIN users u ON u.id = o.user_id JOIN movies m ON m.id = o.movie_id WHERE o.order_id = ?').get(orderId);
  if (!o) return;
  const text = [`Hello ${o.uname || ''}`.trim() + ',', '', `Thank you. Your purchase is confirmed and "${o.title}" is unlocked on your account.`, '',
    `Film: ${o.title}`, `Amount paid: ${inr(o.amount_paise)} (${o.currency})`, `Order reference: ${o.order_id}`, `Date: ${(o.paid_at || '').slice(0, 10)}`, '',
    `Watch any time: ${config.siteUrl}/film/${o.slug}`, '', 'Refund and cancellation terms: ' + config.siteUrl + '/refunds', '',
    'This is a payment confirmation, not a tax invoice. If you need a GST invoice, reply to this email.'].join('\n');
  const owner = notifyAddress();
  const tasks = [sendMail({ to: o.email, subject: `Your purchase: ${o.title}`, text })];
  if (owner) tasks.push(sendMail({ to: owner, subject: `New sale: ${o.title} (${inr(o.amount_paise)})`, text: `${o.uname || 'A viewer'} (${o.email}) bought "${o.title}" for ${inr(o.amount_paise)}.\nOrder ${o.order_id}.` }));
  return Promise.all(tasks);
}

export function sendReset(email, url) {
  return sendMail({ to: email, subject: 'Reset your password', text: ['Someone (hopefully you) asked to reset the password for this account.', '', `Choose a new password here (the link works once and expires in 60 minutes):`, url, '', 'If you did not ask for this, ignore this email. Your password has not changed.'].join('\n') });
}
