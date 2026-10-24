import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { db } from './db.js';

const COOKIE = 'yp_session';
const MAX_AGE = 1000 * 60 * 60 * 24 * 30;

export const hashPassword = (pw) => bcrypt.hashSync(pw, 11);
export const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export function startSession(res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: MAX_AGE, path: '/',
  });
}
export const endSession = (res) => res.clearCookie(COOKIE, { path: '/' });

export const publicUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

/** Resolve req.user from the session cookie (null if signed out). */
export function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { uid } = jwt.verify(token, config.jwtSecret);
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || null;
    } catch { /* invalid / expired */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}

/** Basic CSRF defence for cookie auth: state-changing requests must come from our own origin. */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.get('host'); } catch { /* bad origin */ }
    if (!ok) return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  next();
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
