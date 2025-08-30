// /api/moderate.js
// Quick moderation endpoint with timeout and no manual review
import crypto from 'node:crypto';
import { cors } from './lib/cors.js';
import { withObservability } from './_lib/observability.js';
import { scanImage } from './_lib/moderation/adapter.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MS = Number(process.env.MOD_MAX_MS || '1000');
const BLOCK_REAL_NUDITY = Number(process.env.MOD_BLOCK_REAL_NUDITY || '0.8');
const BLOCK_HATE_SYMBOL = Number(process.env.MOD_BLOCK_HATE_SYMBOL || '0.7');

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
  const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ allow: false, reason: 'method_not_allowed', diag_id: diagId });
  }
  let image;
  try {
    image = await parseImage(req);
  } catch (e) {
    const msg = e.message === 'file_too_large' ? 'file_too_large' : 'invalid_form';
    return res.status(400).json({ allow: false, reason: msg, diag_id: diagId });
  }

  let scan;
  try {
    scan = await Promise.race([
      scanImage(image),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), MAX_MS)),
    ]);
  } catch {
    scan = { error: true };
  }

  if (scan?.timeout || scan?.error || scan?.labels?.includes('provider_error')) {
    return res.status(200).json({ allow: true, reason: 'indeterminate', diag_id: diagId });
  }

  const scores = scan.scores || {};
  const labels = scan.labels || [];
  const isHentai = labels.includes('hentai') || labels.includes('drawing');

  if (isHentai) {
    return res.status(200).json({ allow: true, scores, diag_id: diagId });
  }

  const nudity = Math.max(scores.nudity_adult || 0, scores.sexual_explicit || 0);
  if (nudity >= BLOCK_REAL_NUDITY) {
    return res.status(200).json({ allow: false, reason: 'real_person_nudity', scores, diag_id: diagId });
  }

  const hate = Math.max(scores.hate_symbol || 0, scores.extremist_content || 0);
  if (hate >= BLOCK_HATE_SYMBOL) {
    return res.status(200).json({ allow: false, reason: 'hate_symbol', scores, diag_id: diagId });
  }

  return res.status(200).json({ allow: true, scores, diag_id: diagId });
}

export default withObservability(handler);
