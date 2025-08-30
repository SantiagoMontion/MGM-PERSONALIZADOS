// /api/moderate-image.js
// Recibe una miniatura y valida contenido usando proveedor configurable
import crypto from 'node:crypto';
import { cors } from './_lib/cors.js';
import { withObservability } from './_lib/observability.js';
import { scanImage } from './_lib/moderation/adapter.ts';
import { decideModeration } from './_lib/moderation/policy.ts';

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

  const scan = await scanImage(image);
  const decision = decideModeration({ labels: scan.labels, scores: scan.scores });
  const allow = decision.action !== 'block';
  return res.status(200).json({
    ok: true,
    diag_id: diagId,
    allow,
    action: decision.action,
    reason: decision.reason,
    scores: scan.scores,
    labels: scan.labels,
    provider: scan.provider,
  });
}

export default withObservability(handler);
