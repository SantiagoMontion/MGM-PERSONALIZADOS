import type { VercelRequest } from '@vercel/node';
import verifyPrintsGate from '../../lib/api/_lib/printsGate.js';

export function verifyAnalyticsAccess(req: VercelRequest): { ok: boolean; error?: string } {
  const expectedToken = process.env.ADMIN_ANALYTICS_TOKEN;
  const rawAdmin = req.headers['x-admin-token'];
  const adminToken = Array.isArray(rawAdmin) ? rawAdmin[0] : rawAdmin;
  if (expectedToken && adminToken && adminToken === expectedToken) {
    return { ok: true };
  }

  const gate = verifyPrintsGate({ headers: req.headers as Record<string, string | string[] | undefined> });
  if (gate.ok) {
    return { ok: true };
  }

  return { ok: false, error: 'unauthorized' };
}

export const ANALYTICS_CORS_HEADERS = 'X-Admin-Token, X-Prints-Gate, Content-Type';
