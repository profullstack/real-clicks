// SQLite store for the real.clicks lead pilot (node:sqlite, one file, one writer).
// Money is kept in integer cents. The ledger is the truth for a vendor's balance;
// vendors.balance_cents is a cache moved in the same transaction.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
create table if not exists vendors (
  id text primary key,
  name text not null,
  niche text not null,
  email text not null,
  website text,
  status text not null default 'offered',
  balance_cents integer not null default 0,
  free_used integer not null default 0,
  committed integer not null default 0,
  note text,
  created_at integer not null,
  last_lead_at integer
);
create table if not exists leads (
  id text primary key,
  niche text not null,
  vendor_id text not null references vendors(id),
  need text not null,
  budget text,
  timeline text,
  company text,
  email text not null,
  page_url text,
  ip text,
  ua text,
  status text not null,
  code_hash text,
  code_expires integer,
  attempts integer not null default 0,
  qualified integer not null default 0,
  billing text,
  risk_json text,
  signals_json text,
  reject_reason text,
  refund_reason text,
  created_at integer not null,
  verified_at integer,
  delivered_at integer,
  refunded_at integer
);
create index if not exists leads_vendor on leads(vendor_id, status);
create index if not exists leads_created on leads(created_at);
create table if not exists ledger (
  id integer primary key autoincrement,
  vendor_id text not null references vendors(id),
  lead_id text,
  amount_cents integer not null,
  kind text not null,
  ref text unique,
  note text,
  created_at integer not null
);
create table if not exists checkouts (
  id text primary key,
  vendor_id text not null references vendors(id),
  amount_cents integer not null,
  created_at integer not null,
  paid_at integer
);
create table if not exists hours (
  id integer primary key autoincrement,
  hours real not null,
  note text,
  created_at integer not null
);
create table if not exists events (
  id integer primary key autoincrement,
  kind text not null,
  detail text,
  created_at integer not null
);
create table if not exists sends (
  id integer primary key autoincrement,
  vendor_id text,
  to_addr text not null,
  subject text not null,
  message_id text,
  created_at integer not null
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);
  const now = () => Date.now();

  function tx(fn) {
    db.exec('begin immediate');
    try {
      const r = fn();
      db.exec('commit');
      return r;
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
  }

  const api = {
    raw: db,
    tx,
    // ---------------------------------------------------------------- vendors
    vendor: (id) => q('select * from vendors where id = ?').get(id),
    vendors: () => q('select * from vendors order by niche, created_at').all(),
    vendorsFor: (niche) => q("select * from vendors where niche = ? and status in ('offered','active') order by created_at").all(niche),
    liveVendorCount: () => q("select count(*) n from vendors where status in ('offered','active')").get().n,
    upsertVendor(v) {
      q(`insert into vendors (id, name, niche, email, website, status, note, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set name = excluded.name, niche = excluded.niche, email = excluded.email,
           website = coalesce(excluded.website, vendors.website), status = excluded.status, note = coalesce(excluded.note, vendors.note)`).run(
        v.id, v.name, v.niche, v.email, v.website ?? null, v.status ?? 'offered', v.note ?? null, now(),
      );
      return api.vendor(v.id);
    },
    setVendor(id, fields) {
      const allowed = ['name', 'email', 'website', 'status', 'committed', 'note', 'niche'];
      for (const [k, val] of Object.entries(fields)) {
        if (!allowed.includes(k)) continue;
        q(`update vendors set ${k} = ? where id = ?`).run(val, id);
      }
      return api.vendor(id);
    },
    touchVendor: (id) => q('update vendors set last_lead_at = ? where id = ?').run(now(), id),
    useFree: (id) => q('update vendors set free_used = free_used + 1 where id = ?').run(id),

    /** Adds a ledger row and moves the cached balance. ref makes it idempotent: a repeat returns false. */
    post({ vendorId, leadId = null, cents, kind, ref = null, note = null }) {
      return tx(() => {
        if (ref && q('select 1 from ledger where ref = ?').get(ref)) return false;
        q('insert into ledger (vendor_id, lead_id, amount_cents, kind, ref, note, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(
          vendorId, leadId, cents, kind, ref, note, now(),
        );
        q('update vendors set balance_cents = balance_cents + ? where id = ?').run(cents, vendorId);
        return true;
      });
    },
    ledgerFor: (vendorId) => q('select * from ledger where vendor_id = ? order by id desc').all(vendorId),
    ledger: () => q('select * from ledger order by id desc limit 500').all(),

    // ---------------------------------------------------------------- leads
    insertLead(l) {
      q(`insert into leads (id, niche, vendor_id, need, budget, timeline, company, email, page_url, ip, ua, status,
          code_hash, code_expires, qualified, risk_json, signals_json, reject_reason, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        l.id, l.niche, l.vendor_id, l.need, l.budget ?? null, l.timeline ?? null, l.company ?? null, l.email, l.page_url ?? null,
        l.ip ?? null, l.ua ?? null, l.status, l.code_hash ?? null, l.code_expires ?? null, l.qualified ? 1 : 0,
        JSON.stringify(l.risk ?? {}), JSON.stringify(l.signals ?? {}), l.reject_reason ?? null, now(),
      );
      return api.lead(l.id);
    },
    lead: (id) => q('select * from leads where id = ?').get(id),
    leads: (limit = 200) => q('select * from leads order by created_at desc limit ?').all(limit),
    allLeads: () => q('select * from leads order by created_at').all(),
    leadsQueuedFor: (vendorId) => q("select * from leads where vendor_id = ? and status = 'queued' order by created_at").all(vendorId),
    leadsFromIpSince: (ip, since) => q('select count(*) n from leads where ip = ? and created_at > ?').get(ip, since).n,
    setLead(id, fields) {
      const cols = Object.keys(fields);
      if (!cols.length) return api.lead(id);
      q(`update leads set ${cols.map((c) => `${c} = ?`).join(', ')} where id = ?`).run(...cols.map((c) => fields[c]), id);
      return api.lead(id);
    },
    /** Compare-and-set on status: true only for the caller that moved it. */
    moveLead(id, from, to, fields = {}) {
      const cols = Object.keys(fields);
      const r = q(`update leads set status = ?${cols.map((c) => `, ${c} = ?`).join('')} where id = ? and status = ?`).run(
        to, ...cols.map((c) => fields[c]), id, from,
      );
      return r.changes === 1;
    },
    bumpAttempts: (id) => q('update leads set attempts = attempts + 1 where id = ?').run(id),

    // ---------------------------------------------------------------- payments
    insertCheckout: (id, vendorId, cents) => q('insert or ignore into checkouts (id, vendor_id, amount_cents, created_at) values (?, ?, ?, ?)').run(id, vendorId, cents, now()),
    checkout: (id) => q('select * from checkouts where id = ?').get(id),
    markCheckoutPaid: (id) => q('update checkouts set paid_at = ? where id = ? and paid_at is null').run(now(), id).changes === 1,

    // ---------------------------------------------------------------- hours, events, sends
    addHours: (hours, note) => q('insert into hours (hours, note, created_at) values (?, ?, ?)').run(hours, note ?? null, now()),
    hours: () => q('select * from hours order by created_at desc').all(),
    event: (kind, detail) => q('insert into events (kind, detail, created_at) values (?, ?, ?)').run(kind, typeof detail === 'string' ? detail : JSON.stringify(detail), now()),
    events: (kind) => (kind ? q('select * from events where kind = ? order by id').all(kind) : q('select * from events order by id desc limit 200').all()),
    logSend: (s) => q('insert into sends (vendor_id, to_addr, subject, message_id, created_at) values (?, ?, ?, ?, ?)').run(s.vendorId ?? null, s.to, s.subject, s.messageId ?? null, now()),
    sends: () => q('select * from sends order by id').all(),
  };
  return api;
}
