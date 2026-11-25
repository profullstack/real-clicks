// The lead pilot: offer -> lead -> email code -> verify -> qualify -> deliver to ONE vendor -> bill.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { CoinPay, readWebhook, verifyWebhook } from '@profullstack/coinpay-onboard';
import { buyerSentEmail, codeEmail, leadEmail, SITE } from './mail.js';
import { activeUser, EMAIL_RE, emailDomain, mailDomainOk, reputation } from './risk.js';

export const PRICE_CENTS = 5000;
export const FREE_SAMPLES = 2;
export const MAX_VENDORS = 5;
export const NICHES = { gpu: 'GPU / server rental', security: 'Pentest / security assessment' };
export const PILOT = { start: '2026-11-25', day14: '2026-12-09' };
export const CONSENT = (name) => `Your request goes only to ${name}, who will contact you about a quote. We never sell or share it with anyone else.`;

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const id = (p) => `${p}_${randomBytes(9).toString('base64url')}`;
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const usd = (c) => `$${(c / 100).toFixed(2)}`;

export function createService({ db, env = process.env, mailer = null, fetchImpl = fetch, log = console.log, now = Date.now, resolver, coinpay: coinpayOverride } = {}) {
  const secret = env.REAL_CLICKS_SECRET || 'dev-secret';
  const coinpay = coinpayOverride !== undefined ? coinpayOverride : env.COINPAY_API_KEY ? new CoinPay({ token: env.COINPAY_API_KEY, base: env.COINPAY_API_URL || undefined }) : null;
  const mac = (s) => createHmac('sha256', secret).update(s).digest('base64url');
  const sameMac = (a, b) => {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && timingSafeEqual(x, y);
  };

  async function send(msg, vendorId = null) {
    if (!mailer) {
      log(`mail (not configured) to ${msg.to}: ${msg.subject}`);
      return null;
    }
    const r = await mailer(msg);
    db.logSend({ vendorId, to: Array.isArray(msg.to) ? msg.to.join(',') : msg.to, subject: msg.subject, messageId: r?.messageId });
    return r;
  }

  const canDeliver = (v) => v.balance_cents >= PRICE_CENTS || v.free_used < FREE_SAMPLES;

  /** The vendor a new request on this niche goes to: deliverable first, then the one that waited longest. */
  function pickVendor(niche) {
    const vs = db.vendorsFor(niche);
    if (!vs.length) return null;
    vs.sort((a, b) => Number(canDeliver(b)) - Number(canDeliver(a)) || (a.last_lead_at ?? 0) - (b.last_lead_at ?? 0) || a.created_at - b.created_at);
    return vs[0];
  }

  function offer(niche) {
    if (!NICHES[niche]) throw new HttpError(400, 'niche must be gpu or security');
    const v = pickVendor(niche);
    if (!v) return { available: false };
    const issued = now();
    const token = `${issued}.${v.id}.${niche}.${mac(`${issued}.${v.id}.${niche}`)}`;
    return {
      available: true,
      niche,
      title: niche === 'gpu' ? 'Get a GPU or server quote' : 'Get a pentest or security assessment quote',
      vendor: { id: v.id, name: v.name, website: v.website },
      consent: CONSENT(v.name),
      privacy_url: `${SITE}/privacy`,
      token,
    };
  }

  function readToken(token) {
    const [issued, vendorId, niche, sig] = String(token ?? '').split('.');
    if (!sig || !sameMac(sig, mac(`${issued}.${vendorId}.${niche}`))) throw new HttpError(400, 'this form expired; reload the page and try again');
    return { issued: Number(issued), vendorId, niche };
  }

  async function createLead(body, { ip, ua }) {
    const t = readToken(body.token);
    const vendor = db.vendor(t.vendorId);
    if (!vendor || !['offered', 'active'].includes(vendor.status)) throw new HttpError(409, 'that vendor is not taking requests now; reload the page');
    if (body.vendor_id && body.vendor_id !== vendor.id) throw new HttpError(400, 'vendor mismatch');
    const email = clip(body.email, 200).toLowerCase();
    const need = clip(body.need, 2000);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'enter a valid work email');
    if (need.length < 15) throw new HttpError(400, 'tell the vendor a little more about what you need');
    if (db.leadsFromIpSince(ip ?? '', now() - 3600_000) >= 5) throw new HttpError(429, 'too many requests from this network; try again later');

    const signals = activeUser(
      { interactions: body.signals?.interactions, keys: body.signals?.keys, webdriver: body.signals?.webdriver === true, honeypot: clip(body.website_url, 200) },
      now() - t.issued,
    );
    const domain = emailDomain(email);
    const [mail, risk] = await Promise.all([mailDomainOk(domain, resolver), reputation({ ip, domain }, env, fetchImpl)]);
    const reasons = [...signals.reasons];
    if (!mail.ok) reasons.push(mail.reason);
    if (risk.listed) reasons.push(`ThreatCrush lists this source (score ${risk.score})`);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const lead = db.insertLead({
      id: id('ld'),
      niche: t.niche,
      vendor_id: vendor.id,
      need,
      budget: clip(body.budget, 120),
      timeline: clip(body.timeline, 120),
      company: clip(body.company, 160),
      email,
      page_url: clip(body.page_url, 500),
      ip,
      ua: clip(ua, 300),
      status: 'pending',
      code_hash: sha(`${code}:${secret}`),
      code_expires: now() + 30 * 60_000,
      qualified: reasons.length === 0,
      risk,
      signals: { ...body.signals, elapsed_ms: now() - t.issued, mail_ok: mail.ok },
      reject_reason: reasons.join('; ') || null,
    });
    // A honeypot or automation hit never gets a mail (no free mail relay for bots); it just looks accepted.
    if (signals.reasons.some((r) => r.includes('honeypot') || r.includes('automation'))) {
      db.setLead(lead.id, { status: 'rejected' });
      return { lead_id: lead.id, status: 'verify' };
    }
    const verifyUrl = `${SITE}/v/${lead.id}/${code}`;
    await send({ to: email, ...codeEmail({ code, vendorName: vendor.name, verifyUrl }) });
    return { lead_id: lead.id, status: 'verify', vendor: vendor.name };
  }

  async function verifyLead(leadId, code) {
    const lead = db.lead(leadId);
    if (!lead) throw new HttpError(404, 'request not found');
    if (lead.status !== 'pending') {
      if (lead.verified_at) return { status: lead.status, vendor: db.vendor(lead.vendor_id).name };
      throw new HttpError(410, 'this request can no longer be confirmed');
    }
    if (lead.attempts >= 5) throw new HttpError(429, 'too many wrong codes; send the form again');
    if (now() > lead.code_expires) throw new HttpError(410, 'the code expired; send the form again');
    db.bumpAttempts(lead.id);
    if (!sameMac(sha(`${String(code).trim()}:${secret}`), lead.code_hash)) throw new HttpError(400, 'that code is not right');
    if (!lead.qualified) {
      db.moveLead(lead.id, 'pending', 'unqualified', { verified_at: now() });
      log(`lead ${lead.id}: verified but not qualified (${lead.reject_reason})`);
      return { status: 'held', message: 'Thanks, your email is confirmed. Your request needs a manual check before it is passed on; we will email you if anything is needed.' };
    }
    if (!db.moveLead(lead.id, 'pending', 'verified', { verified_at: now() })) return { status: db.lead(lead.id).status };
    return deliver(lead.id);
  }

  /** Sends a verified lead to its vendor and bills it: $50 from balance, else a free sample, else queued. */
  async function deliver(leadId) {
    const lead = db.lead(leadId);
    const vendor = db.vendor(lead.vendor_id);
    let billing;
    if (vendor.balance_cents >= PRICE_CENTS) {
      db.post({ vendorId: vendor.id, leadId: lead.id, cents: -PRICE_CENTS, kind: 'debit', ref: `debit:${lead.id}` });
      billing = 'paid';
    } else if (vendor.free_used < FREE_SAMPLES) {
      db.useFree(vendor.id);
      billing = 'free_sample';
    } else {
      db.moveLead(lead.id, lead.status, 'queued', { billing: 'queued' });
      db.touchVendor(vendor.id);
      await send({
        to: vendor.email,
        subject: `A verified quote request is waiting for ${vendor.name} (top up to receive it)`,
        text: `A buyer chose ${vendor.name} for a ${NICHES[lead.niche]} quote and verified their email. You have used your ${FREE_SAMPLES} free sample leads, so this one waits until your prepaid balance covers $50.\n\nTop up with CoinPay (crypto or PayPal), no contract, stop anytime: ${SITE}/topup/${vendor.id}\n\nThe lead is delivered the moment the payment confirms.\n\nriotcoder, Profullstack`,
      }, vendor.id);
      return { status: 'queued', vendor: vendor.name, message: `Thanks, your request is confirmed and goes only to ${vendor.name}.` };
    }
    const fresh = db.vendor(vendor.id);
    db.moveLead(lead.id, lead.status, 'delivered', { billing, delivered_at: now() });
    db.touchVendor(vendor.id);
    const refundUrl = `${SITE}/refund/${lead.id}/${mac(`refund:${lead.id}`)}`;
    await send({ to: vendor.email, ...leadEmail({ lead, vendor: fresh, billing, balanceCents: fresh.balance_cents, refundUrl, topupUrl: `${SITE}/topup/${vendor.id}` }) }, vendor.id);
    await send({ to: lead.email, ...buyerSentEmail({ vendor: fresh }) }).catch((e) => log(`buyer mail failed: ${e.message}`));
    log(`lead ${lead.id} -> ${vendor.id} (${billing})`);
    return { status: 'delivered', vendor: vendor.name, message: `Thanks, your request went to ${vendor.name}. They will contact you about a quote.` };
  }

  /** Manual check passed: deliver a verified lead the automatic checks held back. */
  async function approve(leadId, note = '') {
    const lead = db.lead(leadId);
    if (!lead) throw new HttpError(404, 'lead not found');
    if (lead.status !== 'unqualified') throw new HttpError(409, `lead is ${lead.status}, only held (unqualified) leads can be approved`);
    db.setLead(lead.id, { qualified: 1, reject_reason: `${lead.reject_reason ?? ''} [approved: ${clip(note, 200) || 'manual check'}]` });
    if (!db.moveLead(lead.id, 'unqualified', 'verified')) throw new HttpError(409, 'lead changed meanwhile');
    db.event('approve', { lead: lead.id, note });
    return deliver(lead.id);
  }

  /** Flat refund: an invalid lead is credited back $50 if it was paid; free samples are just marked invalid. */
  function refund(leadId, reason, actor) {
    const lead = db.lead(leadId);
    if (!lead) throw new HttpError(404, 'lead not found');
    if (lead.refunded_at) return { ok: true, already: true };
    const why = clip(reason, 500) || 'no reason given';
    if (lead.billing === 'paid') db.post({ vendorId: lead.vendor_id, leadId: lead.id, cents: PRICE_CENTS, kind: 'refund', ref: `refund:${lead.id}`, note: `${actor}: ${why}` });
    db.setLead(lead.id, { refunded_at: now(), refund_reason: `${actor}: ${why}`, qualified: 0 });
    db.event('refund', { lead: lead.id, vendor: lead.vendor_id, actor, reason: why, credited: lead.billing === 'paid' });
    log(`lead ${lead.id} refunded by ${actor}: ${why}`);
    return { ok: true, credited_cents: lead.billing === 'paid' ? PRICE_CENTS : 0 };
  }
  const refundTokenOk = (leadId, token) => sameMac(token, mac(`refund:${leadId}`));

  async function topupUrl(vendorId, amountUsd = 250) {
    const v = db.vendor(vendorId);
    if (!v) throw new HttpError(404, 'vendor not found');
    if (!coinpay) throw new HttpError(503, 'payments are not configured');
    const amount = Math.max(50, Math.min(5000, Math.round(Number(amountUsd) || 250)));
    const session = await coinpay.createCheckoutSession({
      amount,
      description: `real.clicks prepaid lead balance for ${v.name} (${Math.floor(amount / 50)} verified leads at $50)`,
      customerEmail: v.email,
      accountId: v.id,
      property: 'real.clicks.pit.world',
      metadata: { vendor_id: v.id },
      successUrl: `${SITE}/vendors?paid=1`,
      cancelUrl: `${SITE}/vendors`,
      expiresInMinutes: 120,
    });
    db.insertCheckout(session.id, v.id, amount * 100);
    return session.url;
  }

  async function coinpayWebhook(rawBody, signature) {
    if (!env.COINPAY_WEBHOOK_SECRET || !verifyWebhook(rawBody, signature, env.COINPAY_WEBHOOK_SECRET)) return { status: 401, body: { error: 'bad signature' } };
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { error: 'bad json' } };
    }
    const ev = readWebhook(payload);
    if (!ev.paid) return { status: 200, body: { ok: true, ignored: ev.type || 'not paid' } };
    const co = ev.checkoutSessionId ? db.checkout(ev.checkoutSessionId) : null;
    const vendorId = co?.vendor_id || ev.metadata?.vendor_id;
    const v = vendorId && db.vendor(String(vendorId));
    if (!v) return { status: 200, body: { ok: true, ignored: 'no matching vendor' } };
    // Credit what the vendor bought (the session amount), not the coin amount net of network fees.
    const cents = co?.amount_cents ?? Math.round((ev.amountUsd || 0) * 100);
    const fresh = db.post({ vendorId: v.id, cents, kind: 'topup', ref: `topup:${ev.checkoutSessionId || ev.paymentId}`, note: `${ev.method} ${ev.paymentId}` });
    if (!fresh) return { status: 200, body: { ok: true, duplicate: true } };
    if (co) db.markCheckoutPaid(co.id);
    if (v.status === 'offered') db.setVendor(v.id, { status: 'active', committed: 1 });
    db.event('topup', { vendor: v.id, cents });
    log(`vendor ${v.id} topped up ${usd(cents)}`);
    for (const q of db.leadsQueuedFor(v.id)) {
      if (db.vendor(v.id).balance_cents < PRICE_CENTS) break;
      await deliver(q.id).catch((e) => log(`queued lead ${q.id}: ${e.message}`));
    }
    return { status: 200, body: { ok: true } };
  }

  async function signupVendor(body) {
    const name = clip(body.name, 80);
    const email = clip(body.email, 200).toLowerCase();
    const niche = body.niche === 'security' ? 'security' : 'gpu';
    if (!name || !EMAIL_RE.test(email)) throw new HttpError(400, 'company name and a valid sales email are required');
    const vid = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || id('v');
    const existing = db.vendor(vid);
    if (existing && existing.email !== email) throw new HttpError(409, 'a vendor with that name exists; email riotcoder@profullstack.com');
    const status = existing?.status ?? (db.liveVendorCount() < MAX_VENDORS ? 'offered' : 'waitlist');
    db.upsertVendor({ id: vid, name, niche, email, website: clip(body.website, 200) || null, status, note: existing?.note ?? 'self sign-up' });
    db.event('vendor_signup', { vendor: vid, status });
    return { vendor_id: vid, status, topup_url: `${SITE}/topup/${vid}` };
  }

  function stats() {
    const leads = db.allLeads();
    const vendors = db.vendors();
    const count = (f) => leads.filter(f).length;
    const valid = (l) => l.qualified && l.verified_at && !l.refunded_at;
    const weekAgo = now() - 7 * 86400_000;
    const hours = db.hours();
    const per = vendors.map((v) => {
      const mine = leads.filter((l) => l.vendor_id === v.id);
      const ledger = db.ledgerFor(v.id);
      return {
        id: v.id,
        name: v.name,
        niche: v.niche,
        status: v.status,
        committed: Boolean(v.committed),
        balance: v.balance_cents / 100,
        free_used: v.free_used,
        delivered: mine.filter((l) => l.status === 'delivered').length,
        paid: mine.filter((l) => l.billing === 'paid').length,
        free: mine.filter((l) => l.billing === 'free_sample').length,
        queued: mine.filter((l) => l.status === 'queued').length,
        refunded: mine.filter((l) => l.refunded_at).length,
        topped_up: ledger.filter((r) => r.kind === 'topup').reduce((s, r) => s + r.amount_cents, 0) / 100,
      };
    });
    return {
      pilot: PILOT,
      price_usd: PRICE_CENTS / 100,
      fills: leads.length,
      verified: count((l) => l.verified_at),
      qualified: count(valid),
      delivered: count((l) => l.status === 'delivered'),
      queued: count((l) => l.status === 'queued'),
      rejected: count((l) => l.status === 'rejected' || l.status === 'unqualified'),
      refunded: count((l) => l.refunded_at),
      paying_vendors: per.filter((v) => v.topped_up > 0 || v.committed).length,
      revenue_usd: per.reduce((s, v) => s + v.topped_up, 0),
      hours_last_7d: hours.filter((h) => h.created_at > weekAgo).reduce((s, h) => s + h.hours, 0),
      hours_total: hours.reduce((s, h) => s + h.hours, 0),
      hours_log: hours.slice(0, 20),
      vendors: per,
    };
  }

  /** Day-14 kill gates from the board: <10 qualified, <2 paying/committed vendors, or >3 founder h/week. */
  function gates(s = stats()) {
    const weeks = Math.max(1, (now() - Date.parse(`${PILOT.start}T00:00:00Z`)) / (7 * 86400_000));
    const perWeek = s.hours_total / weeks;
    const checks = [
      { gate: 'qualified fills >= 10', value: s.qualified, pass: s.qualified >= 10 },
      { gate: 'paying or committed vendors >= 2', value: s.paying_vendors, pass: s.paying_vendors >= 2 },
      { gate: 'founder hours <= 3 / week', value: Number(perWeek.toFixed(2)), pass: perWeek <= 3 },
    ];
    const pass = checks.every((c) => c.pass);
    return { date: new Date(now()).toISOString().slice(0, 10), pass, verdict: pass ? 'continue B' : 'kill B, ship C (affiliates) + D (marketing)', checks };
  }

  return { offer, createLead, verifyLead, deliver, approve, refund, refundTokenOk, topupUrl, coinpayWebhook, signupVendor, stats, gates, send, canDeliver };
}
