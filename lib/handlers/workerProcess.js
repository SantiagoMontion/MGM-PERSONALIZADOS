import crypto from 'node:crypto';

export default async function workerProcess(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }
  return res.status(501).json({ ok: false, diag_id: diagId, message: 'not_implemented' });
}

