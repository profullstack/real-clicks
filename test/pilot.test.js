import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { signWebhook } from '@profullstack/coinpay-onboard';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';
import { createService } from '../src/service.js';

function setup({ clock = { t: Date.parse('2026-11-26T00:00:00Z') } } = {}) {
  const db = openDb(':memory:');
  const sent = [];
  const mailer = async (m) => { sent.push(m); return { messageId: `m${sent.length}` }; };
  const resolver = { resolveMx: async (d) => (d === 'nomail.test' ? [] : [{ exchange: 'mx.' + d, priority: 10 }]), resolve4: async () => [] };
  const tcFetch = async (url) => ({ ok: true, json: async () => (url.includes('6.6.6.6') ? { listed: true, score: 90 } : { listed: false, score: 0 }) });
  const sessions = [];
  const coinpay = { createCheckoutSession: async (i) => { const s = { id: `cs_${sessions.length + 1}`, url: `https://coinpay.test/checkout/cs_${sessions.length + 1}`, ...i }; sessions.push(s); return s; } };
  const env = { REAL_CLICKS_SECRET: 's', THREATCRUSH_API_KEY: 'tc_agent_x', COINPAY_WEBHOOK_SECRET: 'whsec', REAL_CLICKS_ADMIN_KEY: 'adm' };
  const service = createService({ db, env, mailer, fetchImpl: tcFetch, resolver, coinpay, log: () => {}, now: () => clock.t });
  db.upsertVendor({ id: 'acme-gpu', name: 'Acme GPU', niche: 'gpu', email: 'sales@acme.test' });
  return { db, service, sent, clock, sessions, env };
}
const good = (offer, extra = {}) => ({ token: offer.token, vendor_id: offer.vendor.id, niche: 'gpu', need: 'Need 8x H100 for 3 months in EU', budget: '$2k to $10k/mo', timeline: 'This month', email: 'cto@buyer.test', page_url: 'https://r4ck.dev/servers', signals: { interactions: 12, keys: 40, webdriver: false }, ...extra });
const codeOf = (m) => /code is (\d{6})/.exec(m.text)[1];

test('verified lead: two free samples, then queued, then delivered and billed after top-up; refund credits back', async () => {
  const { db, service, sent, clock, env } = setup();
  for (let i = 0; i < 2; i++) {
    const o = service.offer('gpu');
    assert.match(o.consent, /goes only to Acme GPU/);
    clock.t += 20_000;
    const r = await service.createLead(good(o, { email: `b${i}@buyer.test` }), { ip: `1.2.3.${i}`, ua: 'x' });
    const v = await service.verifyLead(r.lead_id, codeOf(sent.at(-1)));
    assert.equal(v.status, 'delivered');
    assert.equal(db.lead(r.lead_id).billing, 'free_sample');
  }
  const o = service.offer('gpu');
  clock.t += 20_000;
  const r3 = await service.createLead(good(o, { email: 'b3@buyer.test' }), { ip: '1.2.3.9' });
  assert.equal((await service.verifyLead(r3.lead_id, codeOf(sent.at(-1)))).status, 'queued');
  const url = await service.topupUrl('acme-gpu', 100);
  assert.match(url, /cs_1/);
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.confirmed', data: { payment_id: 'p1', status: 'confirmed', amount_usd: 99.1, checkout_session_id: 'cs_1', metadata: { vendor_id: 'acme-gpu' } } });
  const w = await service.coinpayWebhook(body, signWebhook(body, env.COINPAY_WEBHOOK_SECRET));
  assert.equal(w.status, 200);
  assert.equal(db.lead(r3.lead_id).status, 'delivered');
  assert.equal(db.lead(r3.lead_id).billing, 'paid');
  assert.equal(db.vendor('acme-gpu').balance_cents, 5000);
  assert.equal((await service.coinpayWebhook(body, signWebhook(body, env.COINPAY_WEBHOOK_SECRET))).body.duplicate, true);
  const lead = sent.find((m) => m.to === 'sales@acme.test' && /quote request \(verified\)/.test(m.subject) && m.text.includes('b3@buyer.test'));
  const refundPath = /(\/refund\/\S+)/.exec(lead.text)[1];
  const [, , leadId, token] = refundPath.split('/');
  assert.ok(service.refundTokenOk(leadId, token));
  assert.equal(service.refund(leadId, 'fake', 'vendor').credited_cents, 5000);
  assert.equal(db.vendor('acme-gpu').balance_cents, 10000);
  assert.equal(service.refund(leadId, 'again', 'vendor').already, true);
  const s = service.stats();
  assert.equal(s.qualified, 2);
  assert.equal(s.paying_vendors, 1);
});

test('bots and bad sources are never delivered', async () => {
  const { db, service, sent, clock } = setup();
  let o = service.offer('gpu');
  clock.t += 1000; // too fast
  const fast = await service.createLead(good(o), { ip: '1.1.1.1' });
  assert.equal((await service.verifyLead(fast.lead_id, codeOf(sent.at(-1)))).status, 'held');
  o = service.offer('gpu');
  clock.t += 20_000;
  const n = sent.length;
  const hp = await service.createLead(good(o, { website_url: 'http://spam' }), { ip: '1.1.1.2' });
  assert.equal(sent.length, n, 'honeypot gets no mail');
  assert.equal(db.lead(hp.lead_id).status, 'rejected');
  o = service.offer('gpu');
  clock.t += 20_000;
  const listed = await service.createLead(good(o, { email: 'x@ok.test' }), { ip: '6.6.6.6' });
  assert.match(db.lead(listed.lead_id).reject_reason, /ThreatCrush/);
  o = service.offer('gpu');
  clock.t += 20_000;
  await assert.rejects(service.createLead(good(o, { token: o.token.replace(/.$/, 'x') }), { ip: '1.1.1.3' }), /expired/);
  assert.equal(service.stats().delivered, 0);
});

test('http: offer CORS, admin gate, widget served', async () => {
  const { db, service } = setup();
  const server = createServer(createApp({ db, service, env: { REAL_CLICKS_ADMIN_KEY: 'adm' } }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const o = await fetch(`${base}/api/v1/offer?niche=gpu`);
  assert.equal(o.headers.get('access-control-allow-origin'), '*');
  assert.equal((await o.json()).vendor.id, 'acme-gpu');
  assert.equal((await fetch(`${base}/api/v1/stats`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/stats`, { headers: { authorization: 'Bearer adm' } })).status, 200);
  assert.equal((await fetch(`${base}/w.js`)).status, 200);
  const mcp = await (await fetch(`${base}/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
  assert.deepEqual(mcp.result.tools.map((t) => t.name), ['get_offer']);
  server.close();
});
