// api/upload-original.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED = new Set([
  'https://tu-mousepad-personalizado.mgmgamers.store',
  'http://localhost:5173',
]);

function cors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED.has(origin) ? origin : '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

export const config = { memory: 512, maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body: any = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (err) {
      // ignore JSON parse errors and keep string body
    }
  }

  const { url, imageBase64 } = body || {};

  if (process.env.UPLOAD_ENABLED !== '1') {
    return res.status(200).json({
      ok: true,
      mode: 'passthrough',
      url: url || null,
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res
      .status(500)
      .json({ error: 'Supabase not configured (set UPLOAD_ENABLED=0 or add creds)' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    if (url && !imageBase64) {
      return res.status(200).json({ ok: true, mode: 'url', url });
    }

    if (!imageBase64) {
      return res
        .status(400)
        .json({ error: 'No image provided (imageBase64 or url required)' });
    }

    const comma = imageBase64.indexOf(',');
    const b64 = comma >= 0 ? imageBase64.slice(comma + 1) : imageBase64;
    const buffer = Buffer.from(b64, 'base64');

    const ext = 'png';
    const key = `orig/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(key, buffer, {
      contentType: 'image/png',
      upsert: false,
    });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(key);

    return res.status(200).json({ ok: true, mode: 'supabase', url: data.publicUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'upload failed' });
  }
}
