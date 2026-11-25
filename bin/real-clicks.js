#!/usr/bin/env node
// real-clicks CLI: the same admin surface as the API and MCP.
//   REAL_CLICKS_KEY=<admin key> real-clicks stats | gates | leads | vendors | sends
//   real-clicks refund <lead_id> "<reason>"     flat $50 credit back
//   real-clicks topup <vendor_id> [usd]         CoinPay checkout link
//   real-clicks vendor <id> key=value ...       update (or create with name,email,niche)
//   real-clicks hours <h> "<note>"              founder hours log
//   real-clicks offer gpu|security              public: who gets the next request
//   real-clicks tui                             live dashboard in the terminal
//   real-clicks mcp                             stdio MCP bridge to /mcp
import { createInterface } from 'node:readline';

const BASE = (process.env.REAL_CLICKS_URL || 'https://real.clicks.pit.world').replace(/\/$/, '');
const KEY = process.env.REAL_CLICKS_KEY || '';
const [cmd = 'help', ...args] = process.argv.slice(2);

async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(KEY ? { authorization: `Bearer ${KEY}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}
const out = (x) => console.log(JSON.stringify(x, null, 2));

function render(s, g) {
  const row = (cells, w) => cells.map((c, i) => String(c).padEnd(w[i])).join(' ');
  const lines = [
    `\x1b[1;92mreal.clicks lead pilot\x1b[0m  ${s.pilot.start} -> ${s.pilot.day14}  $${s.price_usd}/lead`,
    `fills ${s.fills}  verified ${s.verified}  qualified ${s.qualified}  delivered ${s.delivered}  queued ${s.queued}  refunded ${s.refunded}`,
    `paying vendors ${s.paying_vendors}  top-ups $${s.revenue_usd}  hours 7d ${s.hours_last_7d}`,
    `gates: ${g.verdict}`,
    ...g.checks.map((c) => `  ${c.pass ? '\x1b[92mpass\x1b[0m' : '\x1b[91mmiss\x1b[0m'} ${c.gate}: ${c.value}`),
    '',
    row(['vendor', 'niche', 'status', 'bal', 'deliv', 'paid', 'free', 'queue', 'refund'], [22, 9, 9, 8, 6, 5, 5, 6, 6]),
    ...s.vendors.map((v) => row([v.name.slice(0, 22), v.niche, v.status, `$${v.balance}`, v.delivered, v.paid, v.free, v.queued, v.refunded], [22, 9, 9, 8, 6, 5, 5, 6, 6])),
  ];
  return lines.join('\n');
}

try {
  switch (cmd) {
    case 'stats': out(await api('/api/v1/stats')); break;
    case 'gates': out(await api('/api/v1/gates')); break;
    case 'leads': out(await api(`/api/v1/leads?limit=${args[0] || 50}`)); break;
    case 'vendors': out(await api('/api/v1/vendors')); break;
    case 'sends': out(await api('/api/v1/sends')); break;
    case 'offer': out(await api(`/api/v1/offer?niche=${args[0] || 'gpu'}`)); break;
    case 'refund': out(await api(`/api/v1/leads/${args[0]}/refund`, 'POST', { reason: args.slice(1).join(' ') })); break;
    case 'hours': out(await api('/api/v1/hours', 'POST', { hours: Number(args[0]), note: args.slice(1).join(' ') })); break;
    case 'vendor': out(await api(`/api/v1/vendors/${args[0]}`, 'POST', Object.fromEntries(args.slice(1).map((a) => a.split(/=(.*)/s).slice(0, 2))))); break;
    case 'topup': {
      const r = await fetch(`${BASE}/topup/${args[0]}?amount=${args[1] || 250}`, { redirect: 'manual' });
      console.log(r.headers.get('location') || `HTTP ${r.status}`);
      break;
    }
    case 'tui': {
      const draw = async () => {
        const [s, g] = await Promise.all([api('/api/v1/stats'), api('/api/v1/gates')]);
        process.stdout.write(`\x1b[2J\x1b[H${render(s, g)}\n\n(q to quit, refreshes every 30 s)\n`);
      };
      await draw();
      const t = setInterval(() => draw().catch((e) => console.error(e.message)), 30_000);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.on('data', (b) => { if (b[0] === 113 || b[0] === 3) { clearInterval(t); process.exit(0); } });
      }
      break;
    }
    case 'mcp': {
      const rl = createInterface({ input: process.stdin });
      rl.on('line', async (line) => {
        if (!line.trim()) return;
        try {
          const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) }, body: line });
          if (res.status === 202) return;
          process.stdout.write(`${await res.text()}\n`);
        } catch (e) {
          const id = (() => { try { return JSON.parse(line).id ?? null; } catch { return null; } })();
          process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } })}\n`);
        }
      });
      break;
    }
    default:
      console.log(`real-clicks <stats|gates|leads|vendors|sends|offer|refund|hours|vendor|topup|tui|mcp>\n  env REAL_CLICKS_URL (default ${BASE}), REAL_CLICKS_KEY (admin key)`);
  }
} catch (e) {
  console.error(`real-clicks: ${e.message}`);
  process.exit(1);
}
