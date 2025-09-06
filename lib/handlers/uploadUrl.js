import crypto from 'node:crypto';
import { supa } from '../supa.js';
import { buildObjectKey } from '../_lib/slug.js';

function validateUploadBody(body) {
  if (!body || typeof body !== 'object') return 'invalid_body';
  const { design_name, ext, mime, size_bytes, material, w_cm, h_cm, sha256 } = body;
  if (typeof design_name !== 'string' || design_name.trim().length === 0) return 'design_name_required';
  if (!['jpg','jpeg','png','webp'].includes(String(ext))) return 'ext_invalid';
  if (typeof mime !== 'string' || !/^[\w.-]+\/[\w.+-]+$/.test(mime)) return 'mime_invalid';
  if (typeof size_bytes !== 'number' || !Number.isFinite(size_bytes) || size_bytes <= 0) return 'size_invalid';
  if (!['Classic','PRO'].includes(String(material))) return 'material_invalid';
  if (typeof w_cm !== 'number' || !(w_cm > 0)) return 'w_cm_invalid';
  if (typeof h_cm !== 'number' || !(h_cm > 0)) return 'h_cm_invalid';
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return 'sha256_invalid';
  return null;
}

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 40);
const LIMITS = { Classic: { maxW: 140, maxH: 100 }, PRO: { maxW: 120, maxH: 60 } };

export default async function uploadUrl(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: 'missing_env', diag_id: diagId });
  }

  try {
    let raw = req.body;
    if (!raw || typeof raw !== 'object') {
      raw = await new Promise((resolve, reject) => {
        let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b)); req.on('error', reject);
      });
      try { raw = JSON.parse(String(raw || '{}')); } catch {}
    }
    const vErr = validateUploadBody(raw || {});
    if (vErr) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: vErr });
    }
    const body = raw;

    if ((body.size_bytes || 0) > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: 'file_too_large' });
    }
    const lim = LIMITS[body.material];
    if (!lim) return res.status(400).json({ ok: false, diag_id: diagId, message: 'invalid_material' });
    if (body.w_cm > lim.maxW || body.h_cm > lim.maxH) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: 'size_exceeds_limit' });
    }

    const key = buildObjectKey({
      design_name: body.design_name,
      w_cm: body.w_cm,
      h_cm: body.h_cm,
      material: body.material,
      hash: body.sha256,
      ext: body.ext,
    });

    const uploadsPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/`;
    const url = uploadsPrefix + encodeURIComponent(key);
    return res.status(200).json({ ok: true, upload_url: url, object_key: key });
  } catch (e) {
    return res.status(500).json({ ok: false, diag_id: diagId, message: 'internal_error' });
  }
}

