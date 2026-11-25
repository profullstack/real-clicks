// MCP over HTTP (JSON-RPC 2.0, streamable-HTTP single response). get_offer is public; the rest need the admin key.
export const TOOLS = [
  { name: 'get_offer', description: 'The vendor a new quote request on a niche goes to, with the consent line.', inputSchema: { type: 'object', properties: { niche: { type: 'string', enum: ['gpu', 'security'] } }, required: ['niche'] }, public: true },
  { name: 'pilot_stats', description: 'Fills, verified, qualified, per-vendor delivered/paid/refunded, hours.', inputSchema: { type: 'object', properties: {} } },
  { name: 'pilot_gates', description: 'The day-14 kill gates computed now.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_leads', description: 'Recent leads (newest first).', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'list_vendors', description: 'Vendors with balance and status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'refund_lead', description: 'Flat refund: credit $50 back for an invalid lead, reason logged.', inputSchema: { type: 'object', properties: { lead_id: { type: 'string' }, reason: { type: 'string' } }, required: ['lead_id', 'reason'] } },
  { name: 'topup_link', description: 'A CoinPay checkout link for a vendor prepaid balance.', inputSchema: { type: 'object', properties: { vendor_id: { type: 'string' }, amount_usd: { type: 'number' } }, required: ['vendor_id'] } },
  { name: 'set_vendor', description: 'Update a vendor (status offered|active|paused|waitlist, committed 0|1, email, note).', inputSchema: { type: 'object', properties: { vendor_id: { type: 'string' }, fields: { type: 'object' } }, required: ['vendor_id', 'fields'] } },
  { name: 'log_hours', description: 'Log founder hours spent on vendor handling.', inputSchema: { type: 'object', properties: { hours: { type: 'number' }, note: { type: 'string' } }, required: ['hours'] } },
];

export function createMcpHandler({ service, db, isAdmin }) {
  async function call(name, a = {}) {
    switch (name) {
      case 'get_offer': return service.offer(a.niche);
      case 'pilot_stats': return service.stats();
      case 'pilot_gates': return service.gates();
      case 'list_leads': return db.leads(Number(a.limit) || 50);
      case 'list_vendors': return db.vendors();
      case 'refund_lead': return service.refund(a.lead_id, a.reason, 'mcp');
      case 'topup_link': return { url: await service.topupUrl(a.vendor_id, a.amount_usd || 250) };
      case 'set_vendor': return db.setVendor(a.vendor_id, a.fields || {});
      case 'log_hours': db.addHours(Number(a.hours) || 0, a.note); return { ok: true };
      default: throw new Error(`unknown tool ${name}`);
    }
  }
  return async function handle(msg, req) {
    const { id = null, method, params = {} } = msg ?? {};
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (method === 'initialize') return ok({ protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'real-clicks', version: '0.1.0' } });
    if (method?.startsWith('notifications/')) return null;
    if (method === 'ping') return ok({});
    const admin = isAdmin(req);
    if (method === 'tools/list') return ok({ tools: TOOLS.filter((t) => admin || t.public).map(({ public: _p, ...t }) => t) });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(-32602, 'unknown tool');
      if (!tool.public && !admin) return err(-32001, 'admin key required (Authorization: Bearer)');
      try {
        const r = await call(params.name, params.arguments);
        return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    }
    return err(-32601, 'method not found');
  };
}
