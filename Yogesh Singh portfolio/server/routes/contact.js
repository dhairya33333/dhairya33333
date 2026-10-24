import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { config } from '../config.js';
import { log } from '../log.js';

const r = Router();
export const TOPICS = ['general', 'speaking', 'film', 'press', 'collaboration', 'other'];
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;
const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

// Per-IP: a handful of messages per hour is plenty for a person, and stops a script from flooding the inbox.
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.rate.contact, standardHeaders: true, legacyHeaders: false, message: { error: 'You have sent several messages recently. Please try again in an hour, or email directly.' } });

r.post('/', limiter, (req, res) => {
  const b = req.body || {};
  // Honeypot: a hidden field real visitors never fill. Bots do, and get a normal-looking "sent" reply that stores nothing.
  if (clean(b.website, 200)) { log('warn', 'contact.honeypot'); return res.json({ ok: true }); }
  const name = clean(b.name, 100), email = clean(b.email, 160).toLowerCase(), phone = clean(b.phone, 30), organisation = clean(b.organisation, 120);
  const topic = TOPICS.includes(b.topic) ? b.topic : 'general', message = clean(b.message, 4000);
  const errors = {};
  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!emailOk(email)) errors.email = 'Please enter a valid email address.';
  if (phone && !/^[0-9+()\-\s]{7,30}$/.test(phone)) errors.phone = 'Please enter a valid phone number or leave it empty.';
  if (message.length < 10) errors.message = 'Please write a message of at least 10 characters.';
  if (/https?:\/\/\S+/i.test(message) && (message.match(/https?:\/\//gi) || []).length > 3) errors.message = 'Please include at most 3 links.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: errors });
  db.prepare('INSERT INTO messages (name, email, phone, topic, organisation, message) VALUES (?, ?, ?, ?, ?, ?)').run(name, email, phone || null, topic, organisation || null, message);
  log('info', 'contact.received', { topic });         // no personal details in the log
  res.json({ ok: true });
});

export default r;
