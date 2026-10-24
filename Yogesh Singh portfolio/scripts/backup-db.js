// Consistent online backup of the SQLite database (safe while the site is running), with simple retention.
//   npm run backup-db            -> data/backups/portfolio-YYYYMMDD-HHMMSS.sqlite
// Original movie files are NOT copied here (too large for the same disk); see docs/DEPLOYMENT.md for their backup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirs } from '../server/config.js';
import { db } from '../server/db.js';

export function backupDb({ keep = Number(process.env.BACKUP_KEEP) || 14, dir = dirs.backups } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})/, '$1-');
  const file = path.join(dir, `portfolio-${stamp}.sqlite`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);        // writes a transactionally consistent copy
  const check = db.prepare('PRAGMA quick_check').get();
  const ok = Object.values(check)[0] === 'ok';
  const all = fs.readdirSync(dir).filter((f) => /^portfolio-.*\.sqlite$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old));
  return { file, ok };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = backupDb();
  console.log(`${r.ok ? 'Backup written' : 'BACKUP FAILED INTEGRITY CHECK'}: ${r.file}`);
  process.exit(r.ok ? 0 : 1);
}
