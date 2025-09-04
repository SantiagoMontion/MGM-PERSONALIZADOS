// /api/upload-url.js
// Requiere: "type": "module" en package.json
import crypto from 'node:crypto';
import { z } from 'zod';
import { supa } from '../lib/supa';
import { buildCorsHeaders, preflight, applyCorsToResponse } from '../lib/cors';
import { buildObjectKey } from './_lib/slug';

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

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  // CORS + preflight
  const origin = req.headers.origin || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  // Solo POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  // Env requeridas
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: 'missing_env', diag_id: diagId });
  }

  try {
    const body = BodySchema.parse(req.body);

    // Límites de archivo
    if (body.size_bytes > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ error: 'file_too_large', max_mb: MAX_MB });
    }

    // Límites por material
    const lim = LIMITS[body.material];
    if (body.w_cm > lim.maxW || body.h_cm > lim.maxH) {
      return res.status(400).json({ error: 'size_out_of_bounds', limits: lim });
    }

    // Ruta destino legible
    const object_key = buildObjectKey({
      design_name: body.design_name,
      w_cm: body.w_cm,
      h_cm: body.h_cm,
      material: body.material,
      hash: body.sha256,
      ext: body.ext,
    });

    // Firmar subida: expira en 60s
    const { data, error } = await supa
      .storage
      .from('uploads')
      .createSignedUploadUrl(object_key, 60);

    if (error) {
      console.error('sign_upload_failed', error);
      return res.status(500).json({ error: 'sign_upload_failed' });
    }

    // Respuesta para que el front suba el archivo con supabase-js v2:
    // storage.from('uploads').uploadToSignedUrl(object_key, data.token, file)
    return res.status(200).json({
      bucket: 'uploads',
      object_key,
      upload: {
        provider: 'supabase',
        signed_url: data.signedUrl,
        token: data.token,
        expires_in: 60
      }
    });
  } catch (e) {
    if (e?.issues) {
      return res.status(400).json({ error: 'invalid_body', details: e.issues });
    }
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
