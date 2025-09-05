const Tesseract = require('tesseract.js');
const { withCors } = require('../lib/cors');

const HATE_TERMS = [
  /\bnazi(s)?\b/i,
  /\bhitler\b/i,
  /\bkkk\b/i,
  /\bneo-?nazi\b/i,
  /\bwhite\s*power\b/i,
  /\bsieg\s*heil\b/i,
  /\bheil\b/i,
  /\bswastika\b/i,
];

module.exports = withCors(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const { image_dataurl } = req.body || {};
    if (typeof image_dataurl !== 'string' || !image_dataurl.startsWith('data:image/')) {
      return res.status(400).json({ allow: true, reason: 'skip_no_image' });
    }
    const base64 = image_dataurl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');

    const result = await Tesseract.recognize(buf, 'eng', { logger: () => {} });
    const text = (result?.data?.text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

    let blocked = false;
    const reasons = [];
    for (const rx of HATE_TERMS) {
      if (rx.test(text)) {
        blocked = true;
        reasons.push('hate_speech_explicit');
        break;
      }
    }

    return res.status(200).json({ allow: !blocked, reasons, textSample: text.slice(0, 200) });
  } catch (e) {
    return res.status(200).json({ allow: true, reasons: ['ocr_error'], error: e?.message });
  }
});
