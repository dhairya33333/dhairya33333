import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { boot, signedUpUser } from './helpers.js';

let t;
before(async () => { t = await boot(); });
after(async () => { await t.close(); });

test('database backup is consistent, restorable, and old copies are pruned', async () => {
  await signedUpUser(t, 'backup@example.com');
  const { backupDb } = await import('../scripts/backup-db.js');
  const dir = path.join(t.dataDir, 'bk');
  for (const n of ['portfolio-20200101-000000.sqlite', 'portfolio-20200102-000000.sqlite', 'portfolio-20200103-000000.sqlite']) fs.mkdirSync(dir, { recursive: true }) || fs.writeFileSync(path.join(dir, n), 'old');
  const r = backupDb({ dir, keep: 2 });
  assert.equal(r.ok, true);
  const restored = new DatabaseSync(r.file);
  assert.equal(restored.prepare("SELECT COUNT(*) c FROM users WHERE email = 'backup@example.com'").get().c, 1);
  assert.equal(restored.prepare('PRAGMA user_version').get().user_version >= 2, true);
  restored.close();
  assert.equal(fs.readdirSync(dir).length, 2, 'retention keeps only the newest copies');
});
