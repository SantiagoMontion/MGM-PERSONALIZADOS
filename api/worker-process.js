// /api/worker-process.js  (test de arranque y storage)
import { supa } from '../lib/supa.js';

async function readJson(req){
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  // Método y token
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${process.env.WORKER_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const body = await readJson(req);
    const jobUUID = body?.job_id_uuid || 'no-uuid';

    // subimos un txt de prueba a outputs
    const content = `hello from worker, job=${jobUUID}, ts=${new Date().toISOString()}\n`;
    const key = `debug/${jobUUID}.txt`;

    const up = await supa.storage.from('outputs').upload(key, content, {
      contentType: 'text/plain', upsert: true
    });
    if (up.error) return res.status(500).json({ step: 'upload_txt', error: up.error.message || String(up.error) });

    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/outputs/${key}`;
    return res.status(200).json({ ok: true, txt: publicUrl });
  } catch (e) {
    return res.status(500).json({ step: 'catch', error: String(e?.message || e) });
  }
}
