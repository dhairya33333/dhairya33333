// Anonymous funnel counters. Only "how many times did step X happen on day Y". No cookies, no IP addresses, no user ids, no
// per-visitor trail, so it needs no consent banner and says nothing about any individual.
import { db } from './db.js';

export const CLIENT_STEPS = ['film_view', 'preview_play', 'paywall_shown', 'checkout_open'];
export const STEPS = [...CLIENT_STEPS, 'checkout_started', 'purchase'];
export const LABELS = { film_view: 'Opened the film page', preview_play: 'Watched the preview', paywall_shown: 'Reached the paywall', checkout_open: 'Opened checkout', checkout_started: 'Started payment', purchase: 'Paid' };

export function count(name) {
  if (!STEPS.includes(name)) return;
  try { db.prepare("INSERT INTO events (day, name, n) VALUES (date('now'), ?, 1) ON CONFLICT (day, name) DO UPDATE SET n = n + 1").run(name); } catch { /* analytics must never break a request */ }
}

export function funnel(days = 30) {
  const rows = db.prepare("SELECT name, SUM(n) n FROM events WHERE day >= date('now', ?) GROUP BY name").all(`-${days - 1} days`);
  const total = Object.fromEntries(rows.map((r) => [r.name, r.n]));
  const steps = STEPS.map((s, i) => ({ key: s, label: LABELS[s], count: total[s] || 0 }))
    .map((s, i, a) => ({ ...s, pctOfFirst: a[0].count ? Math.round((s.count / a[0].count) * 1000) / 10 : null, pctOfPrev: i && a[i - 1].count ? Math.round((s.count / a[i - 1].count) * 1000) / 10 : null }));
  const daily = db.prepare("SELECT day, name, n FROM events WHERE day >= date('now', '-13 days') AND name IN ('film_view','purchase') ORDER BY day").all();
  return { days, steps, daily };
}
