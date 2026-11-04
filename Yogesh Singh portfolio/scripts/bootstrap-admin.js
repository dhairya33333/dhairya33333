// Creates the first admin from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD, ONLY if no admin exists yet. Safe to run on every start:
// it never changes an existing admin (so a password changed in the admin panel is not reset). Used by the Docker image (Railway).
import '../server/config.js';
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const { ADMIN_NAME = 'Admin', ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.log('bootstrap-admin: ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping.'); process.exit(0); }
if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) { console.log('bootstrap-admin: an admin already exists, nothing to do.'); process.exit(0); }
if (ADMIN_PASSWORD.length < 10) { console.error('bootstrap-admin: ADMIN_PASSWORD must be at least 10 characters.'); process.exit(1); }
const email = ADMIN_EMAIL.trim().toLowerCase();
const hash = hashPassword(ADMIN_PASSWORD);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) db.prepare("UPDATE users SET role = 'admin', password_hash = ?, name = ?, email_verified = 1 WHERE id = ?").run(hash, ADMIN_NAME, existing.id);
else db.prepare("INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?, ?, ?, 'admin', 1)").run(ADMIN_NAME, email, hash);
console.log(`bootstrap-admin: admin created for ${email}. Remove ADMIN_PASSWORD from the service variables now.`);
