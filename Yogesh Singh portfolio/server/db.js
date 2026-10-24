import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { dirs } from './config.js';

export const db = new DatabaseSync(path.join(dirs.data, 'portfolio.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tagline TEXT DEFAULT '',
  description TEXT DEFAULT '',
  year TEXT DEFAULT '',
  poster TEXT,
  trailer TEXT,
  source_file TEXT,
  duration_sec REAL DEFAULT 0,
  preview_sec INTEGER NOT NULL DEFAULT 1800,
  price_paise INTEGER NOT NULL DEFAULT 29900,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | processing | ready | failed
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  movie_id INTEGER NOT NULL REFERENCES movies(id),
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',    -- CREATED | PAID | FAILED
  gateway TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  user_id INTEGER NOT NULL REFERENCES users(id),
  movie_id INTEGER NOT NULL REFERENCES movies(id),
  order_id TEXT,                              -- NULL = complimentary access granted by admin
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, movie_id)
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                         -- career | film | talk | honour
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  period TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,                       -- instagram | manual
  ext_id TEXT,
  caption TEXT DEFAULT '',
  media_type TEXT DEFAULT 'IMAGE',            -- IMAGE | VIDEO | CAROUSEL_ALBUM
  thumb TEXT,
  permalink TEXT,
  posted_at TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  UNIQUE (source, ext_id)
);
`);

export const getSetting = (key, fallback = '') =>
  db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;

export const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value ?? ''));

export const allSettings = () =>
  Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));

/** Run fn inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
