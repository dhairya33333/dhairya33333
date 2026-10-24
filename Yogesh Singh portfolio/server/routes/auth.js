import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { hashPassword, checkPassword, startSession, endSession, publicUser, asyncHandler } from '../auth.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;

r.post('/register', limiter, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

r.post('/login', limiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !checkPassword(String(req.body.password || ''), user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

r.post('/logout', (_req, res) => { endSession(res); res.json({ ok: true }); });
r.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

export default r;
