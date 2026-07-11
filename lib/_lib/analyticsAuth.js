import verifyPrintsGate from '../api/_lib/printsGate.js';

export function verifyAnalyticsAccess(req) {
  const expectedToken = process.env.ADMIN_ANALYTICS_TOKEN;
  const rawAdmin = req.headers['x-admin-token'];
  const adminToken = Array.isArray(rawAdmin) ? rawAdmin[0] : rawAdmin;
  if (expectedToken && adminToken && adminToken === expectedToken) {
    return { ok: true };
  }

  const gate = verifyPrintsGate({ headers: req.headers || {} });
  if (gate.ok) {
    return { ok: true };
  }

  return { ok: false, error: 'unauthorized' };
}
