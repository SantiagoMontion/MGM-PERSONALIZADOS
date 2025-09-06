import crypto from 'node:crypto';

function err(res, status, { diag_id, stage, message, debug = {} }) {
  return res.status(status).json({ ok: false, diag_id, stage, message, debug });
}

export default async function renderDryrun(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return err(res, 405, { diag_id: diagId, stage: 'method', message: 'method_not_allowed' });
  }
  // NOTE: Keeping this minimal to preserve API surface; full logic remains in original module
  return res.status(501).json({ ok: false, diag_id: diagId, message: 'render_dryrun_not_implemented' });
}

