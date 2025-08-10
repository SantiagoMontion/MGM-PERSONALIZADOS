
import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

// /api/upload-url.js
// Requiere: "type": "module" en package.json
import { z } from 'zod';

import { customAlphabet } from 'nanoid';

const nano = customAlphabet('abcdef0123456789', 8);

const BodySchema = z.object({
  ext: z.enum(['jpg','jpeg','png','webp']),
  mime: z.enum(['image/jpeg','image/png','image/webp']),
  size_bytes: z.number().int().positive(),
  material: z.enum(['Classic','PRO']),
  w_cm: z.number().positive(),
  h_cm: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 40);
const LIMITS = { Classic: { maxW: 140, maxH: 100 }, PRO: { maxW: 120, maxH: 60 } };

export default async function handler(req, res) {
  // CORS + preflight
  if (cors(req, res)) return;

  // Solo POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Env requeridas
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: 'missing_env' });
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

    // IDs y ruta destino
    const now = new Date();
    const ymd = now.toISOString().slice(0,10).replace(/-/g,'');   // YYYYMMDD
    const job_hint = `job_${ymd}_${nano()}`;
    const year = now.getFullYear();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const hash16 = body.sha256.slice(0,16);

    // Guardamos solo bajo 'original/'. El bucket es 'uploads' (privado)
    const object_key = `original/${year}/${mm}/${job_hint}/${hash16}.${body.ext}`;

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
      job_hint,
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

}
