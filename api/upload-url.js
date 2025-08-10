export default async function handler(req, res) {
  try {
    // CORS + método
    const handled = (await (async () => {
      if (typeof cors === 'function' && cors(req, res)) return true;
      if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return true; }
      return false;
    })());
    if (handled) return;

    // ENV
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
      return res.status(500).json({
        error: 'missing_env',
        have: {
          SUPABASE_URL: !!process.env.SUPABASE_URL,
          SUPABASE_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE
        }
      });
    }

    // 1) Ping mínimo: lista buckets
    const ping = await supa.storage.listBuckets();
    if (ping.error) {
      return res.status(500).json({ step: 'listBuckets', message: ping.error.message || String(ping.error) });
    }

    // 2) Intento de firmado con valores de ejemplo (no usa tu body)
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
    const objectKey = `original/${y}/${m}/diag/aaaa1111.jpg`;

    const signed = await supa.storage.from('uploads').createSignedUploadUrl(objectKey, 60);
    if (signed.error) {
      return res.status(500).json({ step: 'createSignedUploadUrl', message: signed.error.message || String(signed.error) });
    }

    return res.status(200).json({
      ok: true,
      buckets: (ping.data || []).map(b => b.name),
      signed_ok: !!signed.data?.signedUrl
    });
  } catch (e) {
    return res.status(500).json({ step: 'catch', message: e?.message || String(e) });
  }
}
