// Usage: npm run reset-2fa -- admin@email.com
// Run on the server if an admin loses their phone AND their recovery codes. Turns two-step sign-in off for that account.
import '../server/config.js';
import { db } from '../server/db.js';

const email = (process.argv[2] || '').toLowerCase();
if (!email) { console.error('Usage: npm run reset-2fa -- email'); process.exit(1); }
const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (!u) { console.error('No such user.'); process.exit(1); }
db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, token_version = token_version + 1 WHERE id = ?').run(u.id);
db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(u.id);
console.log(`Two-step sign-in turned off for ${email}. They can turn it on again under Admin → Security.`);
