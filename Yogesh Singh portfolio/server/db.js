import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { dirs } from './config.js';

const DB_FILE = path.join(dirs.data, 'portfolio.sqlite');
export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// v1 baseline (CREATE IF NOT EXISTS keeps already-deployed databases intact)
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, phone TEXT,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, tagline TEXT DEFAULT '', description TEXT DEFAULT '',
  year TEXT DEFAULT '', poster TEXT, trailer TEXT, source_file TEXT, duration_sec REAL DEFAULT 0,
  preview_sec INTEGER NOT NULL DEFAULT 1800, price_paise INTEGER NOT NULL DEFAULT 29900,
  status TEXT NOT NULL DEFAULT 'draft', progress REAL NOT NULL DEFAULT 0, error TEXT,
  published INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  movie_id INTEGER NOT NULL REFERENCES movies(id), amount_paise INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED',
  gateway TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT
);
CREATE TABLE IF NOT EXISTS purchases (
  user_id INTEGER NOT NULL REFERENCES users(id), movie_id INTEGER NOT NULL REFERENCES movies(id), order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, movie_id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, subtitle TEXT DEFAULT '', period TEXT DEFAULT '', sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, ext_id TEXT, caption TEXT DEFAULT '', media_type TEXT DEFAULT 'IMAGE',
  thumb TEXT, permalink TEXT, posted_at TEXT, hidden INTEGER NOT NULL DEFAULT 0, UNIQUE (source, ext_id)
);
`);

const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
const addColumn = (table, col, def) => { if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };

/** Additive-only migrations. Never drop or rewrite existing data. Order matters; append new ones at the end. */
const MIGRATIONS = [
  // 1: baseline
  () => {},
  // 2: Google sign-in, session versioning, payment ledger, upload tracking, encode state
  () => {
    addColumn('users', 'google_sub', 'TEXT');
    addColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL');

    addColumn('orders', 'provider', 'TEXT');
    addColumn('orders', 'provider_order_id', 'TEXT');
    addColumn('orders', 'provider_payment_id', 'TEXT');
    addColumn('orders', 'currency', "TEXT NOT NULL DEFAULT 'INR'");
    addColumn('orders', 'failure_reason', 'TEXT');
    addColumn('orders', 'refunded_at', 'TEXT');
    addColumn('orders', 'updated_at', 'TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_order ON orders(provider, provider_order_id) WHERE provider_order_id IS NOT NULL');
    db.exec('UPDATE orders SET provider = gateway WHERE provider IS NULL');

    db.exec(`CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY, provider TEXT NOT NULL, event_id TEXT NOT NULL, type TEXT, order_ref TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (provider, event_id))`);

    db.exec(`CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, movie_id INTEGER NOT NULL REFERENCES movies(id), kind TEXT NOT NULL DEFAULT 'upload',
      display_name TEXT, size INTEGER NOT NULL DEFAULT 0, received INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploading',   -- uploading | queued | processing | completed | failed
      path TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);

    addColumn('movies', 'encode_state', "TEXT NOT NULL DEFAULT 'idle'");  // idle | queued | processing | failed
    addColumn('movies', 'validated', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('movies', 'encode_seconds', 'REAL');
    addColumn('movies', 'source_bytes', 'INTEGER');
    addColumn('movies', 'output_bytes', 'INTEGER');
    addColumn('movies', 'segments', 'INTEGER');
    db.exec("UPDATE movies SET validated = 1 WHERE status = 'ready' AND validated = 0"); // existing ready films were playable before

    addColumn('works', 'url', "TEXT DEFAULT ''");
  },
  // 3: refund ledger, disputes, one payment per order, revocable sessions, admin password-reset links, upload owner, indexes
  () => {
    addColumn('orders', 'refunded_paise', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('orders', 'dispute_status', 'TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS orders_provider_payment ON orders(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL');
    db.exec(`CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY, provider TEXT NOT NULL, refund_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES orders(order_id),
      amount_paise INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (provider, refund_id))`);
    db.exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, used_at TEXT,
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    addColumn('uploads', 'created_by', 'INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS orders_user_movie ON orders(user_id, movie_id, status)');
    db.exec('CREATE INDEX IF NOT EXISTS purchases_movie ON purchases(movie_id)');
    db.exec('CREATE INDEX IF NOT EXISTS uploads_movie ON uploads(movie_id, status)');
    db.exec('CREATE INDEX IF NOT EXISTS users_google ON users(google_sub)');
  },
  // 4: contact-form inbox
  () => {
    db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, topic TEXT NOT NULL DEFAULT 'general',
      organisation TEXT, message TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.exec('CREATE INDEX IF NOT EXISTS messages_read ON messages(is_read, id)');
  },
  // 5: cover/author data for Instagram link posts
  () => {
    addColumn('social_posts', 'cover_source', 'TEXT');   // 'fetched' from Instagram, or 'uploaded' by the admin
    addColumn('social_posts', 'author', 'TEXT');
  },
  // 6: checkout consent record
  () => {
    addColumn('orders', 'consent_at', 'TEXT');
    addColumn('orders', 'consent_version', 'TEXT');
  },
  // 7: photo gallery
  () => {
    db.exec(`CREATE TABLE IF NOT EXISTS gallery (
      id INTEGER PRIMARY KEY, src TEXT NOT NULL, thumb TEXT NOT NULL, w INTEGER DEFAULT 0, h INTEGER DEFAULT 0,
      caption TEXT DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  },
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < MIGRATIONS.length; v++) {
  db.exec('BEGIN');
  try { MIGRATIONS[v](); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* may not exist yet */ } }

export const getSetting = (key, fallback = '') =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;

export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value ?? ''));

export const allSettings = () =>
  Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));

/** Run fn inside a transaction (synchronous). */
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
