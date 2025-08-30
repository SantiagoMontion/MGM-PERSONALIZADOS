import { randomUUID } from 'node:crypto';
import { cors } from './lib/cors.js';
import getSupabaseAdmin from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res
      .status(405)
      .json({ ok: false, diag_id: diagId, error: 'method_not_allowed' });
  }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = {};
    }
  }

  const objectKey = body.object_key;
  const contentType = body.contentType;

  if (!objectKey || !contentType) {
    return res
      .status(400)
      .json({ ok: false, diag_id: diagId, error: 'invalid_body' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .storage
      .from('uploads')
      .createSignedUploadUrl(objectKey, 60);

    if (error) {
      console.error('upload-url sign', { diagId, error: error.message });
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
      return res
        .status(500)
        .json({ ok: false, diag_id: diagId, error: 'sign_upload_failed' });
    }

    return res.status(200).json({
      ok: true,
      signed_url: data.signedUrl,
      token: data.token,
      expires_in: 60,
      object_key: objectKey,
    });
  } catch (e) {
    console.error('upload-url unknown', { diagId, error: e?.message || e });
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    return res
      .status(500)
      .json({ ok: false, diag_id: diagId, error: 'internal_error' });
  }
}
