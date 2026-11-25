// Server-rendered pages: vendor sign-up, privacy note, refund form, messages, Anthony's dashboard.
import { esc } from './mail.js';
import { CONSENT, FREE_SAMPLES, MAX_VENDORS, NICHES, PILOT, PRICE_CENTS } from './service.js';

const CSS = `:root{--bg:#070806;--fg:#edf2e4;--dim:#9aa58c;--acc:#a6ff1a;--line:#1d2318;--card:#0e110b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--acc)}main{max-width:980px;margin:0 auto;padding:48px 16px}h1{font-size:clamp(30px,5vw,48px);line-height:1.1;margin:.2em 0 .4em}
.k{font:700 13px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:14px 0}
.cta{display:inline-block;background:var(--acc);color:#081000;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none;border:0;font-size:16px;cursor:pointer}
input,select,textarea{width:100%;background:#000;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;margin:4px 0 12px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}th,td{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600}.n{text-align:right}.dim{color:var(--dim);font-size:14px}.wrap{overflow-x:auto}
.pass{color:var(--acc)}.fail{color:#ff6b5a}`;

const shell = (title, inner, desc = 'real.clicks: verified buyer leads for GPU, server and security vendors.') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · real.clicks</title><meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#070806"><style>${CSS}</style></head><body><main><div class="k"><a href="/" style="text-decoration:none">real.clicks</a> · a Profullstack experiment</div>${inner}</main></body></html>`;

export const messagePage = (title, msg) => shell(title, `<h1>${esc(title)}</h1><div class="card">${msg.startsWith('<') ? msg : `<p>${esc(msg)}</p>`}</div>`);

export const refundPage = (lead) =>
  shell(
    'Refund an invalid lead',
    `<h1>Refund an invalid lead</h1><div class="card"><p>Lead <code>${esc(lead.id)}</code> (${esc(NICHES[lead.niche])}), received ${new Date(lead.created_at).toISOString().slice(0, 10)}.</p>
<p>If it was fake, unreachable, spam or not a real buyer, the $${PRICE_CENTS / 100} goes back on your balance. Flat refund, no argument. The reason only helps us drop bad sources.</p>
<form method="post"><label>What was wrong? (optional)<textarea name="reason" rows="3" maxlength="500"></textarea></label><button class="cta" type="submit">Refund this lead</button></form></div>`,
  );

export function vendorsPage(stats, paid) {
  return shell(
    'For vendors',
    `<h1>Verified quote requests, $${PRICE_CENTS / 100} each.</h1>
${paid ? '<div class="card"><strong>Payment received.</strong> Your balance updates as soon as CoinPay confirms it, and any lead waiting for you is delivered then.</div>' : ''}
<div class="card"><ul>
<li>Buyers on r4ck.dev (server and GPU offers) and threatcrush.com (security) ask for a quote in a short form.</li>
<li>The form names <strong>one</strong> vendor. The buyer agrees to: "${esc(CONSENT('<Vendor>'))}" We never resell or share it.</li>
<li>Each request is email-verified with a code, checked against ThreatCrush reputation data, and needs real typing in a real browser.</li>
<li>Fixed price: <strong>$${PRICE_CENTS / 100} per verified lead</strong>, from a balance you prepay with CoinPay (crypto or PayPal). The first ${FREE_SAMPLES} leads are free so you can judge the quality.</li>
<li>Invalid lead? One click in the lead email credits the $${PRICE_CENTS / 100} back. No contract, no minimum, stop anytime.</li>
<li>At most ${MAX_VENDORS} vendors in the pilot (${stats.vendors.filter((v) => ['offered', 'active'].includes(v.status)).length} places taken). Pilot review on ${PILOT.day14}.</li>
</ul></div>
<div class="card"><h2 style="margin-top:0">Sign up and top up</h2>
<form method="post" action="/api/v1/vendors">
<label>Company<input name="name" required maxlength="80"></label>
<label>Sales email (leads go here)<input name="email" type="email" required maxlength="200"></label>
<label>Website<input name="website" maxlength="200" placeholder="https://"></label>
<label>Niche<select name="niche"><option value="gpu">GPU / server rental</option><option value="security">Pentest / security assessment</option></select></label>
<button class="cta" type="submit">Continue to CoinPay top-up</button></form>
<p class="dim">Already listed? Your top-up link is real.clicks.pit.world/topup/&lt;your vendor id&gt; (default $250 = 5 leads; add ?amount=50 for one).</p></div>
<p class="dim">Questions: <a href="mailto:riotcoder@profullstack.com">riotcoder@profullstack.com</a>. <a href="/privacy">Privacy note</a>.</p>`,
    'Vendors: verified GPU, server and pentest quote requests at $50 each, prepaid with CoinPay, invalid leads refunded.',
  );
}

export const privacyPage = () =>
  shell(
    'Privacy note',
    `<h1>Privacy note</h1><div class="card">
<p>When you ask for a quote through a real.clicks form, we (Profullstack) receive what you type, your email address, the page you were on, your IP address and browser name.</p>
<p><strong>Who gets it:</strong> only the one vendor named in the form, and only after you confirm your email. We never sell, rent or share your request with anyone else, and we never add you to a mailing list.</p>
<p><strong>Why the checks:</strong> we look up your IP and email domain in ThreatCrush reputation data and check that your email domain accepts mail, so vendors only get requests from real people. Those lookups do not send your request anywhere.</p>
<p><strong>How long:</strong> we keep the request for 12 months to handle refunds and fraud, then delete it. Email <a href="mailto:riotcoder@profullstack.com">riotcoder@profullstack.com</a> to have it deleted sooner, or to ask what we hold.</p>
<p>The vendor handles your data under its own privacy policy once it contacts you.</p></div>`,
  );

const d = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');

export function dashboardPage(s, g, leads, sends, events) {
  const v = s.vendors
    .map((x) => `<tr><td>${esc(x.name)}<div class="dim">${esc(x.id)}</div></td><td>${esc(x.niche)}</td><td>${esc(x.status)}${x.committed ? ' · committed' : ''}</td><td class="n">$${x.balance.toFixed(2)}</td><td class="n">${x.delivered}</td><td class="n">${x.paid}</td><td class="n">${x.free}</td><td class="n">${x.queued}</td><td class="n">${x.refunded}</td><td class="n">$${x.topped_up.toFixed(2)}</td></tr>`)
    .join('');
  const l = leads
    .map((x) => `<tr><td>${d(x.created_at)}</td><td>${esc(x.niche)}</td><td>${esc(x.vendor_id)}</td><td>${esc(x.status)}${x.billing ? ` / ${esc(x.billing)}` : ''}${x.refunded_at ? ' / refunded' : ''}</td><td>${x.qualified ? 'yes' : 'no'}</td><td>${esc(x.email)}</td><td>${esc(x.need.slice(0, 80))}</td><td class="dim">${esc(x.reject_reason ?? '')}</td></tr>`)
    .join('');
  const sl = sends.slice(-40).reverse().map((x) => `<tr><td>${d(x.created_at)}</td><td>${esc(x.to_addr)}</td><td>${esc(x.subject)}</td></tr>`).join('');
  const gl = g.checks.map((c) => `<li class="${c.pass ? 'pass' : 'fail'}">${esc(c.gate)}: ${esc(c.value)}</li>`).join('');
  const hl = s.hours_log.map((h) => `<li>${d(h.created_at)}: ${h.hours} h ${esc(h.note ?? '')}</li>`).join('');
  return shell(
    'Dashboard',
    `<h1>Lead pilot dashboard</h1><p class="dim">Pilot ${s.pilot.start} to ${s.pilot.day14}. $${s.price_usd} per verified lead.</p>
<div class="card"><table><tr><th>Fills</th><th>Verified</th><th>Qualified</th><th>Delivered</th><th>Queued</th><th>Rejected/held</th><th>Refunded</th><th>Paying vendors</th><th>Top-ups</th><th>Hours (7d / total)</th></tr>
<tr><td>${s.fills}</td><td>${s.verified}</td><td>${s.qualified}</td><td>${s.delivered}</td><td>${s.queued}</td><td>${s.rejected}</td><td>${s.refunded}</td><td>${s.paying_vendors}</td><td>$${s.revenue_usd.toFixed(2)}</td><td>${s.hours_last_7d} / ${s.hours_total}</td></tr></table></div>
<div class="card"><strong>Day-14 gates now: ${esc(g.verdict)}</strong><ul>${gl}</ul></div>
<div class="card wrap"><h2 style="margin-top:0">Vendors</h2><table><tr><th>Vendor</th><th>Niche</th><th>Status</th><th class="n">Balance</th><th class="n">Delivered</th><th class="n">Paid</th><th class="n">Free</th><th class="n">Queued</th><th class="n">Refunded</th><th class="n">Topped up</th></tr>${v}</table></div>
<div class="card"><h2 style="margin-top:0">Hours note</h2><p class="dim">Log with <code>real-clicks hours 0.5 "replied to vendor"</code> or the log_hours MCP tool.</p><ul>${hl || '<li>none logged</li>'}</ul></div>
<div class="card wrap"><h2 style="margin-top:0">Leads</h2><table><tr><th>When (UTC)</th><th>Niche</th><th>Vendor</th><th>Status</th><th>Qualified</th><th>Email</th><th>Need</th><th>Why not qualified</th></tr>${l || '<tr><td colspan="8">none yet</td></tr>'}</table></div>
<div class="card wrap"><h2 style="margin-top:0">Mail log</h2><table><tr><th>When</th><th>To</th><th>Subject</th></tr>${sl}</table></div>
<div class="card wrap"><h2 style="margin-top:0">Events</h2><ul>${events.map((e) => `<li>${d(e.created_at)} ${esc(e.kind)} ${esc(e.detail ?? '')}</li>`).join('')}</ul></div>`,
  );
}

/** The public page carries the day-14 result once the timer has written it. */
export function injectDay14(page, rows) {
  if (!rows.length) return page;
  const r = JSON.parse(rows[rows.length - 1].detail);
  const block = `<section id="day14"><div class="k">Day 14 result, ${esc(r.date)}</div><h2>${r.pass ? 'The pilot passed its gates.' : 'The pilot missed its gates, so B stops.'}</h2><ul>${r.checks
    .map((c) => `<li>${esc(c.gate)}: <strong>${esc(c.value)}</strong> ${c.pass ? '(pass)' : '(miss)'}</li>`)
    .join('')}</ul><p>Verdict: <strong>${esc(r.verdict)}</strong>. Computed automatically from the lead database.</p></section>`;
  return page.replace('<!--DAY14-->', block);
}
