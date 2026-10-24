import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  hashPassword, checkPassword, passwordProblem, startSession, endSession, publicUser, asyncHandler, requireAuth, GOOGLE_ONLY_HASH,
} from '../auth.js';
import { verifyGoogleIdToken, GoogleAuthError } from '../google.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.rate.auth, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const googleLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.rate.auth + 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;

r.get('/config', (_req, res) => res.json({ googleClientId: config.google.clientId || null }));

r.post('/register', limiter, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists. Try signing in.' });
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash, email_verified) VALUES (?, ?, ?, 0)').run(name, email, hashPassword(password));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

r.post('/login', limiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user?.password_hash === GOOGLE_ONLY_HASH) return res.status(401).json({ error: 'This account uses Google sign-in. Use the "Continue with Google" button.' });
  if (!user || !checkPassword(String(req.body.password || ''), user.password_hash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

/**
 * Google sign-in. The browser obtains an ID token from Google Identity Services and posts it here; we verify it
 * server-side. Matching is by Google's stable `sub`, never by email alone:
 *  - known sub               → sign in
 *  - unknown sub, email free → create a new account (email is Google-verified)
 *  - unknown sub, email used by an existing account → refuse to merge; the owner must sign in with their
 *    password and link Google from their account page (prevents pre-registration account takeover)
 */
r.post('/google', googleLimiter, asyncHandler(async (req, res) => {
  let g;
  try { g = await verifyGoogleIdToken(req.body.credential); }
  catch (e) {
    if (e instanceof GoogleAuthError) return res.status(e.code === 'not_configured' ? 503 : 401).json({ error: e.message, code: e.code });
    throw e;
  }
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(g.sub);
  if (!user) {
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(g.email)) {
      return res.status(409).json({
        code: 'link_required',
        error: 'An account with this email already exists. Sign in with your password, then connect Google from "My account".',
      });
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, password_hash, google_sub, email_verified) VALUES (?, ?, ?, ?, 1)')
      .run(g.name, g.email, GOOGLE_ONLY_HASH, g.sub);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  }
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

// Link Google to the account you are already signed into. The Google email must match the account email.
r.post('/google/link', googleLimiter, requireAuth, asyncHandler(async (req, res) => {
  let g;
  try { g = await verifyGoogleIdToken(req.body.credential); }
  catch (e) { if (e instanceof GoogleAuthError) return res.status(401).json({ error: e.message, code: e.code }); throw e; }
  if (g.email !== req.user.email.toLowerCase()) return res.status(400).json({ error: 'That Google account uses a different email address than this account.' });
  const owner = db.prepare('SELECT id FROM users WHERE google_sub = ?').get(g.sub);
  if (owner && owner.id !== req.user.id) return res.status(409).json({ error: 'That Google account is already connected to another account.' });
  db.prepare('UPDATE users SET google_sub = ?, email_verified = 1 WHERE id = ?').run(g.sub, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
}));

r.post('/password', limiter, requireAuth, asyncHandler(async (req, res) => {
  const current = String(req.body.current || ''), next = String(req.body.password || '');
  const hasPassword = !String(req.user.password_hash).startsWith('!');
  if (hasPassword && !checkPassword(current, req.user.password_hash)) return res.status(400).json({ error: 'Your current password is incorrect.' });
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hashPassword(next), req.user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  startSession(res, fresh); // keep this browser signed in; every other session is now invalid
  res.json({ ok: true });
}));

r.post('/logout', (_req, res) => { endSession(res); res.json({ ok: true }); });
r.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

export default r;
