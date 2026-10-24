import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

const COOKIE = 'yp_session';
const MAX_AGE = config.sessionDays * 24 * 60 * 60 * 1000;
export const GOOGLE_ONLY_HASH = '!google-sign-in-only';   // not a valid bcrypt hash: password login can never match it

export const hashPassword = (pw) => bcrypt.hashSync(pw, 11);
export function checkPassword(pw, hash) {
  if (!hash || hash.startsWith('!')) return false;
  try { return bcrypt.compareSync(pw, hash); } catch { return false; }
}
/** bcrypt ignores everything past 72 bytes, so refuse longer passwords instead of silently truncating. */
export const passwordProblem = (pw) =>
  pw.length < 8 ? 'Password must be at least 8 characters.'
  : Buffer.byteLength(pw) > 72 ? 'Password must be at most 72 bytes (about 72 characters).' : null;

export function startSession(res, user) {
  // tv = token_version: bumping it on the user row invalidates every existing session (password change, etc.)
  const token = jwt.sign({ uid: user.id, tv: user.token_version || 0, jti: randomId(12) }, config.jwtSecret, { expiresIn: `${config.sessionDays}d`, algorithm: 'HS256' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: MAX_AGE, path: '/' });
}
/** Logout revokes the actual token (not only the cookie), so a copied cookie stops working too. */
export function endSession(req, res) {
  const token = req?.cookies?.[COOKIE];
  if (token) {
    try {
      const { jti, exp } = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      if (jti) db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, exp);
    } catch { /* already invalid */ }
  }
  res.clearCookie(COOKIE, { path: '/' });
}
export const purgeRevoked = () => db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));

export const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  hasPassword: !String(u.password_hash).startsWith('!'), googleLinked: !!u.google_sub,
});

export function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { uid, tv, jti } = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      const revoked = jti && db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);
      const u = !revoked && db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (u && (u.token_version || 0) === (tv || 0)) req.user = u;
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

/** CSRF defence for cookie auth: browsers always send Origin on cross-site POST/PUT/DELETE; it must match our host. */
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
export const randomId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
