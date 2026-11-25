# real.clicks

Verified buyer leads for GPU, server and security vendors: https://real.clicks.pit.world

A 14-day pilot (25 Nov to 9 Dec 2026) run on the recommendation of our AI board
([minutes](https://board.saas.pit.world/m/Ij0wyfNFxJgAv-QooS-cBUD9)). A quote form on r4ck.dev and
threatcrush.com pages names **one** vendor; the buyer verifies their email with a 6-digit code; the
request is scored with ThreatCrush reputation data and browser signals, then emailed to that vendor
only. Vendors pay **$50 per verified lead** from a balance prepaid with CoinPay; the first 2 leads are
free; an invalid lead is refunded with one click. No contracts. Never a traffic exchange.

## Surfaces

- **Widget**: `<div data-real-clicks data-niche="gpu"></div><script src="https://real.clicks.pit.world/w.js" defer></script>`
  (CSP: allow `https://real.clicks.pit.world` in script-src, style-src and connect-src).
- **API**: `GET https://real.clicks.pit.world/api` describes it (offer, leads, verify, vendors, top-up, admin).
- **MCP**: `POST https://real.clicks.pit.world/mcp` (JSON-RPC; `get_offer` public, admin tools with the bearer key).
- **CLI / TUI**: `npx @profullstack/real-clicks stats|gates|leads|vendors|refund|topup|hours|tui|mcp`
  with `REAL_CLICKS_KEY`.
- **Dashboard**: `/dashboard` (admin key).

## Run

Node 22.6+ (node:sqlite). `npm ci && npm test && npm start`. Production: dev2 systemd unit
`real-clicks` (User=anthony, 127.0.0.1:8829) behind the Moshpit origin; secrets from the logicsrc vault
`profullstack/real-clicks--prod`; `sh deploy/deploy.sh`. The day-14 gate check is the
`real-clicks-day14.timer` (2026-12-09).

MIT
