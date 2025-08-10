import { z } from 'zod';
import { supa } from '../lib/supa';
import { cors } from '../lib/cors';
import { customAlphabet } from 'nanoid';

const nano = customAlphabet('abcdef0123456789', 8);

const BodySchema = z.object({
  ext: z.enum(['jpg','jpeg','png','webp']),
  mime: z.enum(['image/jpeg','image/png','image/webp']),
  size_bytes: z.number().int().positive(),
  material: z.enum(['Classic','PRO']),
  w_cm: z.number().positive(),
  h_cm: z.number().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 40);
const LIMITS = {
  Classic: { maxW: 140, maxH: 100 },
  PRO:     { maxW: 120, maxH: 60 },
};

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
  return res.status(500).json({ error: 'missing_env', have: {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE
  }});
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const parsed = BodySchema.parse(req.body);
    if (parsed.size_bytes > MAX_MB * 1024 * 1024) {
      return res.status(400).json({ error: 'file_too_large', max_mb: MAX_MB });
    }
    const lim = LIMITS[parsed.material];
    if (parsed.w_cm > lim.maxW || parsed.h_cm > lim.maxH) {
      return res.status(400).json({ error: 'size_out_of_bounds', limits: lim });
    }
    // ext ↔ mime coherente (ya validado por enum)

    // Generar job hint legible (no escribe en DB todavía)
    const today = new Date();
    const ymd = today.toISOString().slice(0,10).replace(/-/g,''); // YYYYMMDD
    const jobHint = `job_${ymd}_${nano()}`;
    const hash16 = parsed.sha256.slice(0,16);
    const year = today.getFullYear();
    const mm = String(today.getMonth()+1).padStart(2,'0');

    const objectKey = `uploads/original/${year}/${mm}/${jobHint}/${hash16}.${parsed.ext}`;

    // Crear URL firmada de SUBIDA (Supabase Storage)
    // Nota: 'uploads' es el bucket privado que creaste.
    const { data, error } = await supa
      .storage
      .from('uploads')
      .createSignedUploadUrl(objectKey, 60); // expira en 60s

    if (error) {
      console.error(error);
      return res.status(500).json({ error: 'sign_upload_failed' });
    }

    // Para subir desde el frontend con supabase-js:
    // storage.from('uploads').uploadToSignedUrl(objectKey, data.token, file)

    return res.status(200).json({
      job_hint: jobHint,
      bucket: 'uploads',
      object_key: objectKey,
      upload: {
        provider: 'supabase',
        signed_url: data.signedUrl,
        token: data.token,
        expires_in: 60
      }
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: 'invalid_body', details: e.issues });
    }
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
