import { withCors } from '../lib/cors.js';
import { checkNSFW } from '../lib/moderation/nsfw.js';
import { checkHate } from '../lib/moderation/hate.js';

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

export default withCors(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await readBody(req);
  let data = {};
  try {
    data = JSON.parse(raw || '{}');
  } catch (_) {
    /* noop */
  }

  let buffer = null;
  let filename = data.filename || '';
  if (data.dataUrl) buffer = toBufferFromDataUrl(data.dataUrl);
  if (!buffer && data.imageBase64)
    buffer = Buffer.from(data.imageBase64, 'base64');

  if (!buffer) return res.status(400).json({ ok: false, error: 'invalid_body' });

  const nsfw = await checkNSFW(buffer);
  if (nsfw.block) {
    return res.status(400).json({ ok: false, reason: 'nsfw_real', preds: nsfw.preds });
  }

  const hate = await checkHate(buffer, filename);
  if (hate.block) {
    return res
      .status(400)
      .json({ ok: false, reason: 'hate_symbol', via: hate.reason });
  }

  return res.status(200).json({ ok: true });
});

