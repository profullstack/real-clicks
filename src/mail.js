// Mail goes out over SMTP as riotcoder@profullstack.com (Forward Email), never Resend.
// Every send is logged in the sends table by the caller.
import nodemailer from 'nodemailer';

export const SITE = 'https://real.clicks.pit.world';
export const SIGNATURE = 'riotcoder, Profullstack\nhttps://real.clicks.pit.world';

export function createMailer(env = process.env) {
  if (!env.SMTP_PASS) return null;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.forwardemail.net',
    port: Number(env.SMTP_PORT || 465),
    secure: Number(env.SMTP_PORT || 465) === 465,
    auth: { user: env.SMTP_USER || 'riotcoder@profullstack.com', pass: env.SMTP_PASS },
  });
  const from = env.MAIL_FROM || 'riotcoder (Profullstack) <riotcoder@profullstack.com>';
  return async function send({ to, cc, subject, text, html, replyTo }) {
    const info = await transport.sendMail({ from, to, cc, subject, text, html, replyTo });
    return { messageId: info.messageId };
  };
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wrap = (body) => `<div style="font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d1d1b;max-width:600px">${body}</div>`;

export function codeEmail({ code, vendorName, verifyUrl }) {
  return {
    subject: `Your quote request code: ${code}`,
    text: `Your code is ${code}\n\nEnter it in the form, or open this link to confirm your request:\n${verifyUrl}\n\nOnce confirmed, your request goes only to ${vendorName}, who will contact you about a quote. We never sell or share it with anyone else.\n\nIf you did not ask for a quote, ignore this email and nothing is sent.\n\n${SIGNATURE}`,
    html: wrap(
      `<p>Your code:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${esc(code)}</p><p>Enter it in the form, or <a href="${esc(verifyUrl)}">confirm your request here</a>.</p><p>Once confirmed, your request goes only to <strong>${esc(vendorName)}</strong>, who will contact you about a quote. We never sell or share it with anyone else.</p><p style="color:#5f5e5a">If you did not ask for a quote, ignore this email and nothing is sent.</p><p>riotcoder, Profullstack<br><a href="${SITE}">real.clicks.pit.world</a></p>`,
    ),
  };
}

export function leadEmail({ lead, vendor, billing, balanceCents, refundUrl, topupUrl }) {
  const nicheLabel = lead.niche === 'gpu' ? 'GPU / server rental' : 'Pentest / security assessment';
  const bill =
    billing === 'paid'
      ? `Billed $50 from your prepaid balance (balance now $${(balanceCents / 100).toFixed(2)}).`
      : `Free sample lead (${vendor.free_used} of 2). After two free leads, new leads wait until your prepaid balance covers $50: ${topupUrl}`;
  const rows = [
    ['Need', lead.need],
    ['Budget', lead.budget || 'not given'],
    ['Timeline', lead.timeline || 'not given'],
    ['Company', lead.company || 'not given'],
    ['Email (verified)', lead.email],
    ['Asked on', lead.page_url || ''],
  ];
  return {
    subject: `New ${nicheLabel} quote request (verified) via real.clicks`,
    replyTo: lead.email,
    text: `A buyer asked for a quote and chose ${vendor.name}. Reply to this email to reach them.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nThe buyer confirmed their email with a code and agreed to this line: "Your request goes only to ${vendor.name}, who will contact you about a quote. We never sell or share it with anyone else." Nobody else received it.\n\n${bill}\n\nInvalid lead (fake, unreachable, spam, or not a real buyer)? One click credits the $50 back, no questions: ${refundUrl}\n\n${SIGNATURE}`,
    html: wrap(
      `<p>A buyer asked for a quote and chose <strong>${esc(vendor.name)}</strong>. Reply to this email to reach them.</p><table style="border-collapse:collapse">${rows
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5f5e5a;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`)
        .join('')}</table><p style="color:#5f5e5a;font-size:14px">The buyer confirmed their email with a code and agreed to: "Your request goes only to ${esc(vendor.name)}, who will contact you about a quote. We never sell or share it with anyone else." Nobody else received it.</p><p>${esc(bill)}</p><p><a href="${esc(refundUrl)}">Invalid lead? Get the $50 back</a> (one click, no questions).</p><p>riotcoder, Profullstack<br><a href="${SITE}">real.clicks.pit.world</a></p>`,
    ),
  };
}

export function buyerSentEmail({ vendor }) {
  return {
    subject: `Your quote request went to ${vendor.name}`,
    text: `Thanks. Your request is confirmed and went only to ${vendor.name}${vendor.website ? ` (${vendor.website})` : ''}. They will contact you about a quote; reply to them directly.\n\nWe never sell or share your request with anyone else. Privacy note: ${SITE}/privacy\n\n${SIGNATURE}`,
  };
}
