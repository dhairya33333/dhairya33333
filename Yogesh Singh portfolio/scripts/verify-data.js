// Data-integrity check: do payments, purchases and refunds agree with each other?
//   npm run verify-data        (exit code 1 if anything is inconsistent). Safe to run while the site is live (read-only).
import { fileURLToPath } from 'node:url';

export function verifyData(db) {
  const problems = [];
  const add = (rows, msg) => rows.forEach((r) => problems.push(`${msg}: ${JSON.stringify(r)}`));
  const q = (sql) => db.prepare(sql).all();

  add(q(`SELECT p.user_id, p.movie_id, p.order_id FROM purchases p LEFT JOIN orders o ON o.order_id = p.order_id
         WHERE p.order_id IS NOT NULL AND (o.order_id IS NULL OR o.status NOT IN ('PAID','PARTIALLY_REFUNDED'))`), 'purchase backed by a missing or non-paid order');
  add(q(`SELECT o.order_id, o.status FROM orders o LEFT JOIN purchases p ON p.order_id = o.order_id
         WHERE o.status IN ('PAID','PARTIALLY_REFUNDED') AND p.order_id IS NULL`), 'paid order without an entitlement');
  add(q(`SELECT o.order_id, o.status FROM orders o JOIN purchases p ON p.order_id = o.order_id WHERE o.status IN ('REFUNDED','CHARGEBACK')`), 'revoked order still grants access');
  add(q(`SELECT o.order_id FROM orders o JOIN purchases p ON p.order_id = o.order_id WHERE p.user_id <> o.user_id OR p.movie_id <> o.movie_id`), 'entitlement does not match the order owner/film');
  add(q(`SELECT o.order_id, o.refunded_paise, COALESCE(SUM(r.amount_paise),0) AS recorded FROM orders o LEFT JOIN refunds r ON r.order_id = o.order_id
         GROUP BY o.order_id HAVING o.refunded_paise <> recorded`), 'refunded total differs from the refund records');
  add(q("SELECT order_id, amount_paise, refunded_paise FROM orders WHERE status = 'REFUNDED' AND refunded_paise < amount_paise"), 'order marked REFUNDED but not fully refunded');
  add(q("SELECT order_id, amount_paise, refunded_paise FROM orders WHERE status = 'PARTIALLY_REFUNDED' AND (refunded_paise <= 0 OR refunded_paise >= amount_paise)"), 'partial-refund status with a non-partial amount');
  add(q("SELECT order_id FROM orders WHERE status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND (provider_payment_id IS NULL OR paid_at IS NULL)"), 'paid order missing payment reference or time');
  add(q("SELECT order_id, amount_paise, currency FROM orders WHERE amount_paise <= 0 OR currency <> 'INR'"), 'order with an invalid amount or currency');
  add(q("SELECT slug FROM movies WHERE published = 1 AND (status <> 'ready' OR validated <> 1)"), 'published film that is not ready and validated');
  add(q("SELECT id FROM users WHERE role NOT IN ('user','admin')"), 'user with an unknown role');
  add(q('PRAGMA foreign_key_check'), 'foreign-key violation');
  const ic = db.prepare('PRAGMA integrity_check').get(); if (Object.values(ic)[0] !== 'ok') problems.push(`database integrity_check: ${Object.values(ic)[0]}`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { db } = await import('../server/db.js');
  const problems = verifyData(db);
  if (problems.length) { console.error(`${problems.length} problem(s):\n- ` + problems.join('\n- ')); process.exit(1); }
  console.log('Data is consistent: payments, refunds, purchases and films agree.');
}
