// Fills the site with sample timeline entries so you can see the design populated. Safe to run repeatedly.
import '../server/config.js';
import { db } from '../server/db.js';
if (db.prepare('SELECT COUNT(*) c FROM works').get().c === 0) {
  const ins = db.prepare('INSERT INTO works (kind,title,subtitle,period,sort) VALUES (?,?,?,?,?)');
  [
    ['career', 'Indian Police Service', 'Years of field leadership, law enforcement and public duty. (Edit in admin)', 'Career', 1],
    ['film', 'Feature film as director', 'A story about courage and conscience. (Edit in admin)', 'Cinema', 2],
    ['talk', 'Keynotes & motivational talks', 'Universities, institutions and corporate stages across India. (Edit in admin)', 'Speaking', 3],
    ['honour', 'Honours & recognition', 'Add awards and recognitions here. (Edit in admin)', 'Recognition', 4],
  ].forEach((w) => ins.run(...w));
  console.log('Sample timeline added.');
}
