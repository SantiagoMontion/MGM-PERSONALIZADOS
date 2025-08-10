// /api/worker-process.js (DIAGNÓSTICO)
import { supa } from '../lib/supa.js';

async function readJson(req){
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  try {
    // Paso 0: método
    if (req.method !== 'POST') return res.status(405).json({ step: 'method', error: 'method_not_allowed' });

    // Paso 1: token
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.WORKER_TOKEN}`) {
      return res.status(401).json({ step: 'auth', error: 'unauthorized', hint: 'Use WORKER_TOKEN (Vercel), no el token de Supabase' });
    }

    // Paso 2: body
    const body = await readJson(req);
    if (!body?.job_id_uuid) return res.status(400).json({ step: 'body', error: 'missing_job_id_uuid' });

    // Paso 3: env de Supabase
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
      return res.status(500).json({ step: 'env', error: 'missing_supabase_env' });
    }

    // Paso 4: ping a Supabase
    const lb = await supa.storage.listBuckets();
    if (lb.error) return res.status(500).json({ step: 'listBuckets', error: String(lb.error?.message || lb.error) });

    // Paso 5: cargar job
    const { data: job, error: jErr } = await supa.from('jobs').select('*').eq('id', body.job_id_uuid).single();
    if (jErr || !job) return res.status(404).json({ step: 'load_job', error: String(jErr?.message || 'job_not_found') });

    // Paso 6: validar URL de original (no descargamos aún)
    const m = (job.file_original_url || '').match(/\/storage\/v1\/object\/(private|public)\/([^/]+)\/(.+)$/);
    if (!m) return res.status(400).json({ step: 'parse_url', error: 'invalid_supabase_storage_url', url: job.file_original_url });
    const [, visibility, bucket, key] = m;

    // Paso 7: HEAD/download pequeño para confirmar acceso
    const dl = await supa.storage.from(bucket).download(key);
    if (dl.error) return res.status(500).json({ step: 'download', error: String(dl.error?.message || dl.error), bucket, key, visibility });

    // Si llegamos hasta acá, todo lo crítico está bien
    return res.status(200).json({
      ok: true,
      step: 'all_checks_passed',
      job_id: job.job_id,
      bucket,
      key,
      visibility
    });
  } catch (e) {
    return res.status(500).json({ step: 'catch', error: String(e?.message || e) });
  }
}
