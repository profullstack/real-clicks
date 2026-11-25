// Is this quote request from a real, reachable person? Three independent checks:
// 1. ThreatCrush reputation for the client IP and the email's domain (tc_agent_ key).
// 2. The email domain accepts mail (MX, else A) and is not a known throwaway.
// 3. Browser signals from the widget: real interaction, time on form, honeypot, automation flag.
import { promises as dns } from 'node:dns';

const DISPOSABLE = new Set(
  'mailinator.com guerrillamail.com 10minutemail.com tempmail.com temp-mail.org yopmail.com trashmail.com sharklasers.com getnada.com dispostable.com maildrop.cc throwawaymail.com fakeinbox.com mintemail.com mohmal.com emailondeck.com tempail.com burnermail.io spamgourmet.com mailnesia.com'.split(' '),
);
const FREE = new Set('gmail.com googlemail.com yahoo.com hotmail.com outlook.com live.com icloud.com me.com aol.com proton.me protonmail.com gmx.com mail.com yandex.com zoho.com'.split(' '));

export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;

export function emailDomain(email) {
  return String(email).split('@').pop().toLowerCase();
}

export async function mailDomainOk(domain, resolver = dns) {
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable email domain' };
  try {
    const mx = await resolver.resolveMx(domain);
    if (mx.length && !(mx.length === 1 && mx[0].exchange === '')) return { ok: true };
  } catch {
    /* fall through to A */
  }
  try {
    const a = await resolver.resolve4(domain);
    if (a.length) return { ok: true };
  } catch {
    /* none */
  }
  return { ok: false, reason: 'email domain does not accept mail' };
}

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80)/i;

async function tcLookup(target, key, fetchImpl) {
  const res = await fetchImpl(`https://threatcrush.com/api/v1/reputation/${encodeURIComponent(target)}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`threatcrush ${res.status}`);
  return res.json();
}

/** ThreatCrush verdicts for the IP and email domain. Lookup failures are 'unknown', never 'clean'. */
export async function reputation({ ip, domain }, env = process.env, fetchImpl = fetch) {
  const key = env.THREATCRUSH_API_KEY;
  const out = { ip: null, domain: null, listed: false, score: 0, unknown: [] };
  if (!key) {
    out.unknown.push('no ThreatCrush key');
    return out;
  }
  const jobs = [];
  if (ip && !PRIVATE.test(ip)) jobs.push(['ip', ip]);
  if (domain && !FREE.has(domain)) jobs.push(['domain', domain]);
  await Promise.all(
    jobs.map(async ([kind, target]) => {
      try {
        const r = await tcLookup(target, key, fetchImpl);
        out[kind] = { listed: Boolean(r.listed), score: Number(r.score) || 0, severity: r.severity ?? null, reports: r.reports ?? 0 };
        out.score = Math.max(out.score, out[kind].score);
        if (r.listed && (Number(r.score) || 0) >= 50) out.listed = true;
      } catch (e) {
        out.unknown.push(`${kind}: ${e.message}`);
      }
    }),
  );
  return out;
}

/**
 * Widget signals. `interactions` counts trusted pointer/key/touch/scroll events on the form,
 * `elapsed_ms` is server-measured from the signed offer token, `webdriver` is navigator.webdriver.
 */
export function activeUser({ interactions = 0, keys = 0, webdriver = false, honeypot = '' }, elapsedMs) {
  const reasons = [];
  if (honeypot) reasons.push('honeypot filled');
  if (webdriver) reasons.push('browser reports automation');
  if (elapsedMs < 5000) reasons.push('form filled in under 5 seconds');
  if (elapsedMs > 6 * 3600 * 1000) reasons.push('offer token expired');
  if (Number(interactions) < 3 || Number(keys) < 5) reasons.push('no real typing or pointer interaction');
  return { active: reasons.length === 0, reasons };
}
