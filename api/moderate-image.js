// /api/moderate-image.js
// Recibe una miniatura y valida contenido usando Sightengine
import crypto from 'node:crypto';
import { cors } from './_lib/cors.js';
import { withObservability } from './_lib/observability.js';

const MAX_BYTES = 2 * 1024 * 1024;
const rate = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const entry = rate.get(ip) || { count: 0, ts: now };
  if (now - entry.ts > 60_000) {
    entry.count = 0;
    entry.ts = now;
  }
  entry.count++;
  rate.set(ip, entry);
  return entry.count <= 10; // 10 req/min por IP
}

async function parseImage(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw new Error('missing_boundary');
  const boundary = Buffer.from('--' + boundaryMatch[1]);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('file_too_large');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const start = buffer.indexOf(boundary);
  if (start < 0) throw new Error('invalid_form');
  let s = start + boundary.length + 2; // skip CRLF
  const next = buffer.indexOf(boundary, s);
  if (next < 0) throw new Error('invalid_form');
  const part = buffer.slice(s, next - 2); // trim CRLF
  const headerEnd = part.indexOf('\r\n\r\n');
  const header = part.slice(0, headerEnd).toString();
  if (!/name="image"/.test(header)) throw new Error('missing_image');
  return part.slice(headerEnd + 4);
}

async function moderateWithSightengine(buf) {
  const user = process.env.SIGHTENGINE_USER;
  const key = process.env.SIGHTENGINE_KEY;
  if (!user || !key) throw new Error('missing_credentials');
  const url = new URL('https://api.sightengine.com/1.0/check.json');
  url.searchParams.set('models', 'nudity-2.0,offensive');
  url.searchParams.set('api_user', user);
  url.searchParams.set('api_secret', key);
  const form = new FormData();
  form.append('media', new File([buf], 'image.jpg'));
  const resp = await fetch(url, { method: 'POST', body: form });
  const data = await resp.json();
  const nudity = data.nudity || {};
  const offensive = data.offensive || {};
  const scores = { nudity, offensive };
  const reasons = [];
  const nudityBlock = Number(process.env.MOD_NUDITY_BLOCK || '0.85');
  const sexyBlock = Number(process.env.MOD_SEXY_BLOCK || '0.9');
  const adultScore = nudity.sexual_activity || nudity.sexual_display || nudity.explicit || 0;
  const sexyScore = nudity.suggestive || nudity.soft || 0;
  if (adultScore >= nudityBlock || sexyScore >= sexyBlock) reasons.push('real_nudity');
  const hate = (offensive.classes || []).some(c => ['swastika','nazi','kkk','ss'].includes(c.class) && c.prob > 0.5);
  if (hate) reasons.push('hate_symbol');
  return { allow: reasons.length === 0, reasons, scores, provider: 'sightengine' };
}

async function handler(req, res) {
  const diagId = crypto.randomUUID();
  res.setHeader('X-Diag-Id', diagId);
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, diag_id: diagId, allow: false, message: 'rate_limited' });
  }
  let image;
  try {
    image = await parseImage(req);
  } catch (e) {
    const msg = e.message === 'file_too_large' ? 'file_too_large' : 'invalid_form';
    return res.status(400).json({ ok: false, diag_id: diagId, allow: false, message: msg });
  }
  try {
    const result = await moderateWithSightengine(image);
    return res.status(200).json({ ok: true, diag_id: diagId, ...result });
  } catch (e) {
    console.error('moderation_error', e);
    return res.status(500).json({ ok: false, diag_id: diagId, allow: false, message: 'provider_error' });
  }
}

export default withObservability(handler);
