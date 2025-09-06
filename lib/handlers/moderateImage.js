import { checkNSFW } from '../moderation/nsfw.server.js';
import { checkHate, initHateTemplates } from '../moderation/hate.js';

// precache hate templates, best-effort
initHateTemplates().catch(() => {});

function toBufferFromDataUrl(dataUrl) {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return Buffer.from(m[2], 'base64');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export default async function moderateImage(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      // CORS handled globally by router; just acknowledge
      return res.status(204).end();
    }
    if (req.method !== 'POST') return res.status(405).end();

    const raw = await readBody(req);
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return res.status(400).json({ ok: false, reason: 'invalid_body' });
    }

    let buffer = null;
    const filename = data?.filename || '';
    if (data?.dataUrl) buffer = toBufferFromDataUrl(data.dataUrl);
    if (!buffer && data?.imageBase64) buffer = Buffer.from(data.imageBase64, 'base64');
    if (!buffer) return res.status(400).json({ ok: false, reason: 'invalid_body' });

    const nsfw = await checkNSFW(buffer);
    if (nsfw.block) {
      return res.status(400).json({ ok: false, reason: 'nsfw_real', preds: nsfw.preds });
    }

    const hate = await checkHate(buffer, filename);
    if (hate.block) {
      return res.status(400).json({ ok: false, reason: 'hate_symbol', via: hate.reason });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    try { console.error('moderate-image error', e); } catch {}
    return res.status(500).json({ ok: false });
  }
}

