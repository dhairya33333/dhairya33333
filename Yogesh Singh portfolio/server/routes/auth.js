import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { config } from '../config.js';
import {
  randomId, hashPassword, checkPassword, passwordProblem, startSession, endSession, publicUser, asyncHandler, requireAuth, GOOGLE_ONLY_HASH,
} from '../auth.js';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { log } from '../log.js';
import { newSecret, verifyTotp, otpauthUri, sealSecret, openSecret, newRecoveryCodes, hashRecovery } from '../totp.js';
import { mailConfigured, sendReset } from '../mailer.js';
import { verifyGoogleIdToken, GoogleAuthError } from '../google.js';

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.rate.auth, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const googleLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.rate.auth + 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } });
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160;

// ---- two-step sign-in ----
// After a correct password (or Google token) a user with two-step on gets a short-lived ticket, NOT a session. The ticket
// only works at /2fa/verify, allows 5 wrong codes, and is single use.
const tickets = new Map();                                  // jti -> failed attempts (in memory: a restart just makes the user sign in again)
function finishLogin(res, user) {
  if (!user.totp_enabled) { startSession(res, user); return res.json({ user: publicUser(user) }); }
  const jti = randomId(12); tickets.set(jti, 0); setTimeout(() => tickets.delete(jti), 5 * 60 * 1000).unref();
  const ticket = jwt.sign({ uid: user.id, jti, purpose: '2fa' }, config.jwtSecret, { expiresIn: '5m', algorithm: 'HS256' });
  res.json({ twofa: true, ticket });
}
/** True if `code` is a valid authenticator code (not reused) or an unused recovery code; consumes whichever matched. */
function checkSecondFactor(user, code) {
  const step = verifyTotp(openSecret(user.totp_secret), code, { lastStep: user.totp_last_step });
  if (step) { db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id); return true; }
  const h = hashRecovery(code);
  if (String(code).replace(/[^a-fA-F0-9]/g, '').length === 10) {
    const used = db.prepare("UPDATE recovery_codes SET used_at = datetime('now') WHERE user_id = ? AND code_hash = ? AND used_at IS NULL").run(user.id, h);
    if (used.changes) { log('warn', 'twofa.recovery_used', { user: user.id }); return true; }
  }
  return false;
}
r.post('/2fa/verify', limiter, asyncHandler(async (req, res) => {
  let p; try { p = jwt.verify(String(req.body.ticket || ''), config.jwtSecret, { algorithms: ['HS256'] }); } catch { return res.status(401).json({ error: 'Your sign-in expired. Please sign in again.', code: 'ticket_expired' }); }
  if (p.purpose !== '2fa' || !tickets.has(p.jti)) return res.status(401).json({ error: 'Your sign-in expired. Please sign in again.', code: 'ticket_expired' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.uid);
  if (!user || !user.totp_enabled) return res.status(401).json({ error: 'Please sign in again.', code: 'ticket_expired' });
  if (!checkSecondFactor(user, req.body.code)) {
    const n = (tickets.get(p.jti) || 0) + 1; if (n >= 5) tickets.delete(p.jti); else tickets.set(p.jti, n);
    log('warn', 'twofa.failed', { user: user.id });
    return res.status(401).json({ error: n >= 5 ? 'Too many wrong codes. Please sign in again.' : 'That code is not right. Check your authenticator app and try again.', code: n >= 5 ? 'ticket_expired' : 'bad_code' });
  }
  tickets.delete(p.jti);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  startSession(res, fresh); res.json({ user: publicUser(fresh) });
}));

const needPassword = (user, body) => String(user.password_hash).startsWith('!') || checkPassword(String(body.password || ''), user.password_hash);

r.post('/2fa/setup', limiter, requireAuth, asyncHandler(async (req, res) => {
  if (req.user.totp_enabled) return res.status(400).json({ error: 'Two-step sign-in is already on.' });
  if (!needPassword(req.user, req.body)) return res.status(400).json({ error: 'Your password is incorrect.' });
  const secret = newSecret();
  db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(sealSecret(secret), req.user.id);
  const uri = otpauthUri(secret, req.user.email, 'Yogesh Singh');
  res.json({ secret: secret.match(/.{1,4}/g).join(' '), uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
}));
r.post('/2fa/enable', limiter, requireAuth, asyncHandler(async (req, res) => {
  const u = req.user; if (u.totp_enabled || !u.totp_pending) return res.status(400).json({ error: 'Start setup first.' });
  const step = verifyTotp(openSecret(u.totp_pending), req.body.code);
  if (!step) return res.status(400).json({ error: 'That code is not right. Check your authenticator app and try again.' });
  const codes = newRecoveryCodes();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ?, token_version = token_version + 1 WHERE id = ?').run(step, u.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
    for (const c of codes) db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)').run(u.id, hashRecovery(c));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  log('info', 'twofa.enabled', { user: u.id });
  startSession(res, db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));        // other devices are signed out
  res.json({ ok: true, recoveryCodes: codes });
}));
r.post('/2fa/disable', limiter, requireAuth, asyncHandler(async (req, res) => {
  const u = req.user; if (!u.totp_enabled) return res.status(400).json({ error: 'Two-step sign-in is not on.' });
  if (!needPassword(u, req.body)) return res.status(400).json({ error: 'Your password is incorrect.' });
  if (!checkSecondFactor(u, req.body.code)) return res.status(400).json({ error: 'That code is not right.' });
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, token_version = token_version + 1 WHERE id = ?').run(u.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
  log('warn', 'twofa.disabled', { user: u.id });
  startSession(res, db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)); res.json({ ok: true });
}));

r.get('/config', (_req, res) => res.json({ googleClientId: config.google.clientId || null, emailReset: mailConfigured() }));

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
  finishLogin(res, user);
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
  finishLogin(res, user);
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

// Password recovery without email: an admin issues a one-time link (Admin → Users), the user opens it and sets a new password.
r.post('/reset', limiter, asyncHandler(async (req, res) => {
  const token = String(req.body.token || '');
  const problem = passwordProblem(String(req.body.password || ''));
  if (problem) return res.status(400).json({ error: problem });
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = token.length >= 32 && db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hash);
  if (!row || row.used_at || row.expires_at < Date.now()) return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask the site admin for a new one.' });
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(hash);
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hashPassword(String(req.body.password)), row.user_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true });
}));

// Self-service reset by email. The answer is identical whether or not the address has an account (no account enumeration),
// and it only works when email is configured. Rate limited like the other auth routes.
r.post('/forgot', limiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
  const same = { ok: true, message: 'If that address has an account, a reset link is on its way. It works once and expires in 60 minutes.' };
  if (!mailConfigured()) return res.status(503).json({ error: 'Email is not set up on this site yet. Please ask the site admin for a reset link.' });
  const u = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
  // At most one reset email per account every 2 minutes, so the form cannot be used to flood someone's inbox.
  if (u && !db.prepare("SELECT 1 FROM password_resets WHERE user_id = ? AND created_by IS NULL AND created_at > datetime('now', '-2 minutes')").get(u.id)) {
    const token = randomId(24);
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, NULL)').run(crypto.createHash('sha256').update(token).digest('hex'), u.id, Date.now() + 60 * 60 * 1000);
    sendReset(u.email, `${config.siteUrl}/reset-password.html?token=${token}`);   // not awaited: response time must not reveal whether the account exists
    log('info', 'password_reset.emailed', { user: u.id });
  }
  res.json(same);
}));

r.post('/logout', (req, res) => { endSession(req, res); res.json({ ok: true }); });
r.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

export default r;
