// real.clicks: the public site, the lead API, the widget, MCP, the vendor top-up and refund links,
// and Anthony's dashboard. One Node process, one SQLite file.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDb } from './db.js';
import { createMailer } from './mail.js';
import { createMcpHandler } from './mcp.js';
import { dashboardPage, messagePage, refundPage, vendorsPage, privacyPage, injectDay14 } from './pages.js';
import { createService, HttpError } from './service.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
const PUBLIC_CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };

export const API_DOCS = {
  name: 'real.clicks lead API',
  version: VERSION,
  base: 'https://real.clicks.pit.world/api/v1',
  public: {
    'GET /api/v1/offer?niche=gpu|security': 'the vendor a new request goes to, the consent line, and a signed form token',
    'POST /api/v1/leads': '{token, vendor_id, niche, need, budget, timeline, company, email, page_url, signals:{interactions,keys,webdriver}, website_url (honeypot, leave empty)} -> emails a 6-digit code',
    'POST /api/v1/leads/:id/verify': '{code} -> delivered | queued | held',
    'POST /api/v1/vendors': '{name, email, niche, website} vendor sign-up -> {vendor_id, topup_url}',
    'GET /topup/:vendor_id?amount=250': 'CoinPay checkout for a prepaid lead balance ($50 per verified lead)',
  },
  admin: 'Authorization: Bearer <REAL_CLICKS_ADMIN_KEY>: GET /api/v1/stats, /api/v1/gates, /api/v1/leads, /api/v1/vendors; POST /api/v1/leads/:id/refund {reason}; POST /api/v1/leads/:id/approve {note} (deliver a held lead after a manual check); POST /api/v1/vendors/:id {fields}; POST /api/v1/hours {hours, note}; POST /mcp (JSON-RPC MCP).',
  widget: '<div data-real-clicks data-niche="gpu"></div><script src="https://real.clicks.pit.world/w.js" defer></script>',
};

function clientIp(req) {
  // dev2 nginx appends the pit.world relay; the relay appends the real client before it.
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (xff.length >= 2) return xff[xff.length - 2];
  return xff[0] || req.socket.remoteAddress || '';
}

async function body(req, limit = 64 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new HttpError(413, 'too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function parsed(req) {
  const raw = await body(req);
  if (String(req.headers['content-type']).includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'bad json');
  }
}

export function createApp({ db, service, env = process.env }) {
  const adminKey = env.REAL_CLICKS_ADMIN_KEY || '';
  const isAdmin = (req) => {
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const cookie = /(?:^|;\s*)rc_admin=([^;]+)/.exec(String(req.headers.cookie ?? ''))?.[1] ?? '';
    const given = auth || decodeURIComponent(cookie);
    if (!adminKey || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(adminKey);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const mcp = createMcpHandler({ service, db, isAdmin });

  const json = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC, ...extra });
    res.end(JSON.stringify(obj));
  };
  const html = (res, status, page, extra = {}) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC, ...extra });
    res.end(page);
  };

  function staticFile(res, path) {
    const file = normalize(join(ROOT, path.startsWith('/w.') ? 'public' : 'site', path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT) || !existsSync(file)) return false;
    let data = readFileSync(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    if (path === '/' || path === '/index.html') data = Buffer.from(injectDay14(data.toString('utf8'), db.events('day14')));
    const widget = path.startsWith('/w.');
    res.writeHead(200, { 'content-type': type, 'cache-control': widget ? 'public, max-age=300' : 'public, max-age=60', ...SEC, ...(widget ? { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' } : {}) });
    res.end(data);
    return true;
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, PUBLIC_CORS);
        return res.end();
      }
      if (p === '/healthz') return json(res, 200, { ok: true, version: VERSION });
      if (p === '/api' || p === '/api/v1' || p === '/api/v1/') return json(res, 200, API_DOCS, PUBLIC_CORS);

      // ------------------------------------------------------------ public lead flow
      if (p === '/api/v1/offer' && req.method === 'GET') return json(res, 200, service.offer(url.searchParams.get('niche')), PUBLIC_CORS);
      if (p === '/api/v1/leads' && req.method === 'POST') {
        const r = await service.createLead(await parsed(req), { ip: clientIp(req), ua: req.headers['user-agent'] });
        return json(res, 201, r, PUBLIC_CORS);
      }
      let m = /^\/api\/v1\/leads\/([\w-]+)\/verify$/.exec(p);
      if (m && req.method === 'POST') return json(res, 200, await service.verifyLead(m[1], (await parsed(req)).code), PUBLIC_CORS);
      m = /^\/v\/([\w-]+)\/(\d{6})$/.exec(p);
      if (m && req.method === 'GET') {
        // Mail scanners prefetch links: show a button, confirm on POST.
        return html(res, 200, messagePage('Confirm your quote request', `<form method="post"><button class="cta" type="submit">Confirm and send my request</button></form>`));
      }
      if (m && req.method === 'POST') {
        try {
          const r = await service.verifyLead(m[1], m[2]);
          return html(res, 200, messagePage('Request confirmed', r.message || `Your request went to ${r.vendor}.`));
        } catch (e) {
          return html(res, e.status || 500, messagePage('Could not confirm', e.message));
        }
      }

      // ------------------------------------------------------------ vendors and money
      if (p === '/api/v1/vendors' && req.method === 'POST') {
        const r = await service.signupVendor(await parsed(req));
        if (String(req.headers['content-type']).includes('form-urlencoded')) {
          res.writeHead(303, { location: `/topup/${r.vendor_id}` });
          return res.end();
        }
        return json(res, 201, r, PUBLIC_CORS);
      }
      m = /^\/topup\/([\w-]+)$/.exec(p);
      if (m && req.method === 'GET') {
        const to = await service.topupUrl(m[1], url.searchParams.get('amount') || 250);
        res.writeHead(303, { location: to, 'cache-control': 'no-store' });
        return res.end();
      }
      if (p === '/api/v1/coinpay/webhook' && req.method === 'POST') {
        const r = await service.coinpayWebhook(await body(req, 256 * 1024), req.headers['x-coinpay-signature']);
        return json(res, r.status, r.body);
      }
      m = /^\/refund\/([\w-]+)\/([\w-]+)$/.exec(p);
      if (m) {
        if (!service.refundTokenOk(m[1], m[2])) return html(res, 403, messagePage('Link not valid', 'This refund link is not valid.'));
        const lead = db.lead(m[1]);
        if (!lead) return html(res, 404, messagePage('Not found', 'No such lead.'));
        if (req.method === 'POST') {
          const r = service.refund(m[1], (await parsed(req)).reason, `vendor:${lead.vendor_id}`);
          return html(res, 200, messagePage('Refund done', r.credited_cents ? 'The $50 is back on your balance. Thanks for telling us.' : r.already ? 'This lead was already refunded.' : 'Marked invalid. It was a free sample, so nothing was charged.'));
        }
        return html(res, 200, refundPage(lead));
      }

      // ------------------------------------------------------------ admin
      if (p === '/dashboard') {
        const k = url.searchParams.get('key');
        if (k && k === adminKey) {
          res.writeHead(303, { location: '/dashboard', 'set-cookie': `rc_admin=${encodeURIComponent(k)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` });
          return res.end();
        }
        if (!isAdmin(req)) return html(res, 401, messagePage('Dashboard', 'Sign in with /dashboard?key=&lt;admin key&gt;.'));
        return html(res, 200, dashboardPage(service.stats(), service.gates(), db.leads(100), db.sends(), db.events()));
      }
      if (p === '/mcp' && req.method === 'POST') {
        const r = await mcp(await parsed(req), req);
        return r === null ? (res.writeHead(202), res.end()) : json(res, 200, r);
      }
      if (p.startsWith('/api/v1/')) {
        if (!isAdmin(req)) return json(res, 401, { error: 'admin key required' });
        if (p === '/api/v1/stats') return json(res, 200, service.stats());
        if (p === '/api/v1/gates') return json(res, 200, service.gates());
        if (p === '/api/v1/leads' && req.method === 'GET') return json(res, 200, db.leads(Number(url.searchParams.get('limit')) || 200));
        if (p === '/api/v1/vendors' && req.method === 'GET') return json(res, 200, db.vendors());
        if (p === '/api/v1/sends') return json(res, 200, db.sends());
        if (p === '/api/v1/hours' && req.method === 'POST') {
          const b = await parsed(req);
          db.addHours(Number(b.hours) || 0, b.note);
          return json(res, 201, { ok: true });
        }
        m = /^\/api\/v1\/leads\/([\w-]+)\/approve$/.exec(p);
        if (m && req.method === 'POST') return json(res, 200, await service.approve(m[1], (await parsed(req)).note));
        m = /^\/api\/v1\/leads\/([\w-]+)\/refund$/.exec(p);
        if (m && req.method === 'POST') return json(res, 200, service.refund(m[1], (await parsed(req)).reason, 'admin'));
        m = /^\/api\/v1\/vendors\/([\w-]+)$/.exec(p);
        if (m && req.method === 'POST') {
          const b = await parsed(req);
          if (!db.vendor(m[1])) {
            if (!b.name || !b.email || !b.niche) throw new HttpError(400, 'new vendor needs name, email, niche');
            return json(res, 201, db.upsertVendor({ id: m[1], ...b }));
          }
          return json(res, 200, db.setVendor(m[1], b));
        }
        return json(res, 404, { error: 'not found' });
      }

      // ------------------------------------------------------------ pages
      if (p === '/vendors') return html(res, 200, vendorsPage(service.stats(), url.searchParams.get('paid') === '1'));
      if (p === '/privacy') return html(res, 200, privacyPage());
      if (req.method === 'GET' && staticFile(res, p)) return;
      return html(res, 404, messagePage('Not found', 'No such page.'));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json(res, status, { error: status === 500 ? 'internal error' : e.message, ...(e.extra ?? {}) }, PUBLIC_CORS);
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb(process.env.REAL_CLICKS_DB || join(process.env.HOME, '.local/share/real-clicks/real-clicks.db'));
  const service = createService({ db, mailer: createMailer() });
  const port = Number(process.env.PORT || 8829);
  createServer(createApp({ db, service })).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`real.clicks ${VERSION} on :${port}`));
}
