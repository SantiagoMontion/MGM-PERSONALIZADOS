import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildCorsHeaders } from '../lib/cors';

type Verdict = {
  allow: boolean;
  reasons: string[];
  details?: any;
};

const NUDE_REAL_THRESHOLD = Number(process.env.NUDE_REAL_THRESHOLD || '0.75');
const HATE_SYMBOL_THRESHOLD = Number(process.env.HATE_SYMBOL_THRESHOLD || '0.80');
const HATE_SPEECH_EXPLICIT_THRESHOLD = Number(process.env.HATE_SPEECH_EXPLICIT_THRESHOLD || '0.85');

async function checkWithHive(buf: Buffer): Promise<Verdict> {
  const apiKey = process.env.HIVE_API_KEY;
  const form = new FormData();
  form.append('models', 'nudity,context,hate_speech,hate_symbols');
  form.append('media', new Blob([buf]), 'image.png');
  const res = await fetch('https://api.thehive.ai/api/v2/task/sync', {
    method: 'POST',
    headers: { Authorization: `token ${apiKey}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  const reasons: string[] = [];
  try {
    const nudity = json?.output?.[0]?.classes?.nudity || {};
    const real = nudity?.sexual_activity || 0;
    if (real >= NUDE_REAL_THRESHOLD) reasons.push('real_person_nudity');
    const hateSym = json?.output?.[0]?.classes?.hate_symbols || {};
    if ((hateSym?.score || 0) >= HATE_SYMBOL_THRESHOLD) reasons.push('extremist_symbol');
    const hateSpeech = json?.output?.[0]?.classes?.hate_speech || {};
    if ((hateSpeech?.score || 0) >= HATE_SPEECH_EXPLICIT_THRESHOLD) reasons.push('hate_speech_explicit');
  } catch {}
  return { allow: reasons.length === 0, reasons, details: json };
}

async function checkWithSightengine(buf: Buffer): Promise<Verdict> {
  const user = process.env.SIGHTENGINE_USER;
  const secret = process.env.SIGHTENGINE_SECRET;
  const form = new FormData();
  form.append('models', 'nudity-2.0,wad,offensive,ocr');
  form.append('media', new Blob([buf]), 'image.png');
  form.append('api_user', user || '');
  form.append('api_secret', secret || '');
  const res = await fetch('https://api.sightengine.com/1.0/check.json', {
    method: 'POST',
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  const reasons: string[] = [];
  try {
    const nudity = json?.nudity || {};
    if ((nudity?.sexual_activity || 0) >= NUDE_REAL_THRESHOLD && nudity?.type !== 'cartoon') {
      reasons.push('real_person_nudity');
    }
    const extremist = json?.wad?.data?.find?.((d:any) => d?.name && d.confidence >= HATE_SYMBOL_THRESHOLD);
    if (extremist) reasons.push('extremist_symbol');
    const text = json?.text?.profanity || {};
    if ((text?.match || 0) >= HATE_SPEECH_EXPLICIT_THRESHOLD) reasons.push('hate_speech_explicit');
  } catch {}
  return { allow: reasons.length === 0, reasons, details: json };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || null;
  const cors = buildCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { image_dataurl, strict } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  if (!image_dataurl?.startsWith('data:image/')) {
    return res.status(400).json({ error: 'invalid_body', message: 'image_dataurl required' });
  }
  const buf = Buffer.from(image_dataurl.split(',')[1], 'base64');

  const provider = process.env.MOD_PROVIDER || 'HIVE';
  let verdict: Verdict = { allow: true, reasons: [] };
  try {
    verdict = provider === 'SIGHTENGINE' ? await checkWithSightengine(buf) : await checkWithHive(buf);
  } catch (e: any) {
    return res.status(200).json({ allow: !strict, reasons: strict ? ['provider_error'] : [], error: e?.message });
  }

  const SENSITIVE = new Set(['real_person_nudity', 'sexual_activity_explicit', 'extremist_symbol', 'hate_speech_explicit']);
  const block = verdict.reasons.some(r => SENSITIVE.has(r));
  return res.status(200).json({ allow: !block, reasons: verdict.reasons, details: verdict.details });
}
