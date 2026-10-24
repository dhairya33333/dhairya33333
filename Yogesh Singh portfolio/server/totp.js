// Two-step sign-in: TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s) as used by Google Authenticator, Authy, 1Password and others,
// plus single-use recovery codes. Written against node:crypto only, and checked against the RFC's published test vectors.
import crypto from 'node:crypto';
import { config } from './config.js';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
export function base32Decode(str) {
  let bits = '';
  for (const c of String(str).toUpperCase().replace(/[\s=-]/g, '')) { const i = ALPHA.indexOf(c); if (i < 0) throw new Error('bad base32'); bits += i.toString(2).padStart(5, '0'); }
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secret, counter, digits = 6, algo = 'sha1') {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algo, secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const totpAt = (secretB32, timeMs, opts = {}) => hotp(base32Decode(secretB32), Math.floor(timeMs / 1000 / 30), opts.digits || 6, opts.algo || 'sha1');

/** Accepts the previous, current and next 30 s step (clock drift). Returns the matching step, or null. A step is never accepted twice. */
export function verifyTotp(secretB32, code, { lastStep = 0, now = Date.now() } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32), step = Math.floor(now / 1000 / 30);
  let hit = null;
  for (const s of [step - 1, step, step + 1]) {
    const a = Buffer.from(hotp(secret, s)), b = Buffer.from(c);
    if (a.length === b.length && crypto.timingSafeEqual(a, b) && s > lastStep) hit = s;   // no early exit: constant work
  }
  return hit;
}

export const otpauthUri = (secret, email, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// The secret must be recoverable to verify codes, so it is encrypted at rest (AES-256-GCM) with a key derived from JWT_SECRET.
const key = () => crypto.createHash('sha256').update('totp-secret-v1:' + config.jwtSecret).digest();
export function sealSecret(plain) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
export function openSecret(sealed) {
  const [iv, tag, ct] = String(sealed).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// Recovery codes: shown once, only hashes stored, each works once.
export const newRecoveryCodes = (n = 10) => Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; });
export const hashRecovery = (code) => crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-f0-9]/g, '')).digest('hex');
