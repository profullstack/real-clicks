// Day-14 check (systemd timer real-clicks-day14, 2026-12-09): compute the board's kill gates from
// the lead DB, record the result (the public page shows it), email Anthony and text him via `alert`.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createMailer } from '../src/mail.js';
import { createService } from '../src/service.js';

const db = openDb(process.env.REAL_CLICKS_DB || join(process.env.HOME, '.local/share/real-clicks/real-clicks.db'));
const mailer = createMailer();
const service = createService({ db, mailer });
const s = service.stats();
const g = service.gates(s);
const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry'); // print only: no record, no mail, no alert
if (db.events('day14').length && !force && !dry) {
  console.log('day-14 result already recorded; --force to recompute');
  process.exit(0);
}
if (!dry) db.event('day14', { ...g, stats: { fills: s.fills, verified: s.verified, qualified: s.qualified, paying_vendors: s.paying_vendors, revenue_usd: s.revenue_usd, hours_total: s.hours_total } });
const lines = g.checks.map((c) => `- ${c.pass ? 'PASS' : 'MISS'} ${c.gate}: ${c.value}`).join('\n');
const text = `real.clicks lead pilot, day 14 (${g.date})\n\nVerdict: ${g.verdict}\n\n${lines}\n\nFills ${s.fills}, verified ${s.verified}, qualified ${s.qualified}, delivered ${s.delivered}, refunded ${s.refunded}, top-ups $${s.revenue_usd}.\n\nPer vendor:\n${s.vendors.map((v) => `- ${v.name}: delivered ${v.delivered} (paid ${v.paid}, free ${v.free}), queued ${v.queued}, refunded ${v.refunded}, topped up $${v.topped_up}`).join('\n')}\n\n${g.pass ? 'B continues.' : 'Per the board: kill B, ship C (affiliate links) plus D (marketing). Never build a traffic exchange.'}\n\nDashboard: https://real.clicks.pit.world/dashboard\nPublic result: https://real.clicks.pit.world/#day14\n\nriotcoder, Profullstack`;
console.log(text);
if (dry) process.exit(0);
if (mailer) await mailer({ to: 'ettinger@gmail.com', cc: 'anthony@profullstack.com', subject: `real.clicks day 14: ${g.verdict}`, text });
try {
  execFileSync(process.env.ALERT_BIN || join(process.env.HOME, '.local/bin/alert'), ['--key', 'real-clicks-day14', `real.clicks day 14: ${g.verdict} (qualified ${s.qualified}, paying vendors ${s.paying_vendors})`], { stdio: 'inherit' });
} catch (e) {
  console.error(`alert failed: ${e.message}`);
}
