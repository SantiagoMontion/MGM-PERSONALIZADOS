import type { VercelRequest, VercelResponse } from '@vercel/node';
import Tesseract from 'tesseract.js';
import { buildCorsHeaders } from '../lib/cors';

const HATE_TERMS = [
  /\bnazi(s)?\b/i, /\bhitler\b/i, /\bkkk\b/i, /\bneo-?nazi\b/i,
  /\bwhite\s*power\b/i, /\bsieg\s*heil\b/i, /\bheil\b/i, /\bswastika\b/i
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k,v])=>res.setHeader(k,v as string));
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error:'method_not_allowed' });
  if (!cors) return res.status(403).json({ error:'origin_not_allowed' });
  Object.entries(cors).forEach(([k,v])=>res.setHeader(k,v as string));

  try {
    const { image_dataurl } = req.body || {};
    if (typeof image_dataurl !== 'string' || !image_dataurl.startsWith('data:image/')) {
      return res.status(400).json({ allow: true, reason: 'skip_no_image' });
    }
    const base64 = image_dataurl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');

    // OCR gratis
    const result = await Tesseract.recognize(buf, 'eng', { logger: () => {} });
    const text = (result?.data?.text || '').toLowerCase().replace(/\s+/g, ' ').trim();

    let blocked = false;
    let reasons: string[] = [];
    for (const rx of HATE_TERMS) {
      if (rx.test(text)) { blocked = true; reasons.push('hate_speech_explicit'); break; }
    }

    return res.status(200).json({ allow: !blocked, reasons, textSample: text.slice(0,200) });
  } catch (e:any) {
    // Si OCR falla, NO bloquear (evitar falsos positivos)
    return res.status(200).json({ allow: true, reasons: ['ocr_error'], error: e?.message });
  }
}
