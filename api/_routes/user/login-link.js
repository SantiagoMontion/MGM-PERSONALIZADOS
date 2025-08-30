import { randomUUID } from 'node:crypto';
import { withObservability } from '../../_lib/observability.js';
import { createUserToken } from '../../_lib/userToken.js';

async function handler(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, diag_id: diagId, message: 'missing_email' });
  const token = createUserToken(email);
  const base = process.env.PUBLIC_BASE_URL || '';
  const link = `${base}/mis-disenos?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  if (process.env.NODE_ENV !== 'production') {
    console.log('[login-link]', link);
  }
  // En producción enviar email aquí
  return res.status(200).json({ ok: true, diag_id: diagId });
}

export default withObservability(handler);
