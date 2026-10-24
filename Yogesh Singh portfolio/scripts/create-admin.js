// Usage: npm run create-admin -- "Full Name" admin@email.com 'a-strong-password'
import '../server/config.js';
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const [name = 'Admin', email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD] = process.argv.slice(2);
if (!email || !password || password.length < 10) {
  console.error('Usage: npm run create-admin -- "Name" email password(10+ chars)');
  process.exit(1);
}
const hash = hashPassword(password);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) db.prepare("UPDATE users SET role='admin', password_hash=?, name=? WHERE id=?").run(hash, name, existing.id);
else db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')").run(name, email.toLowerCase(), hash);
console.log(`Admin ready: ${email}`);
