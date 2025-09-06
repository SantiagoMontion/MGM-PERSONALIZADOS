import crypto from 'node:crypto';
import { z } from 'zod';
import { supa } from '../supa.js';
import { buildObjectKey } from '../_lib/slug.js';

const BodySchema = z.object({
  design_name: z.string().min(1),
  ext: z.enum(['jpg', 'jpeg', 'png', 'webp']),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size_bytes: z.number().int().positive(),
  material: z.enum(['Classic', 'PRO']),
  w_cm: z.number().positive(),
  h_cm: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

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
    const parsed = BodySchema.safeParse(raw || {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, diag_id: diagId, message: 'invalid_body' });
    }
    const body = parsed.data;

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

