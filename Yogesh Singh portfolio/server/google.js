import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
let client;

export class GoogleAuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Tests inject locally generated signing certs so the real library verification path runs without network.
let testCerts = null;
export function setTestCerts(certs) {
  if (process.env.NODE_ENV !== 'test') throw new Error('setTestCerts is test-only');
  testCerts = certs;
}

/**
 * Verifies a Google ID token (signature, issuer, audience, expiry via google-auth-library) and then
 * requires a verified email and a stable subject id. Returns only the fields we use.
 */
export async function verifyGoogleIdToken(idToken) {
  const clientId = config.google.clientId;
  if (!clientId) throw new GoogleAuthError('not_configured', 'Google sign-in is not configured.');
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) throw new GoogleAuthError('invalid_token', 'Invalid Google sign-in.');
  client ||= new OAuth2Client(clientId);

  let payload;
  try {
    if (testCerts) payload = (await client.verifySignedJwtWithCertsAsync(idToken, testCerts, clientId, ISSUERS)).getPayload();
    else payload = (await client.verifyIdToken({ idToken, audience: clientId })).getPayload();
  } catch {
    throw new GoogleAuthError('invalid_token', 'Google sign-in could not be verified. Please try again.');
  }
  // Defence in depth: do not rely on the library alone for the claims that decide who someone is.
  if (!payload || payload.aud !== clientId || !ISSUERS.includes(payload.iss)) throw new GoogleAuthError('invalid_token', 'Invalid Google sign-in.');
  if (!payload.sub) throw new GoogleAuthError('invalid_token', 'Invalid Google sign-in.');
  if (payload.email_verified !== true) throw new GoogleAuthError('email_unverified', 'Your Google email address is not verified.');
  if (!payload.email) throw new GoogleAuthError('invalid_token', 'Google did not provide an email address.');
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: String(payload.name || payload.email.split('@')[0]).slice(0, 80) };
}
