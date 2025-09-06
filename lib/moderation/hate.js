// Text-only hate symbol/term checker for server runtime (no heavy image libs)
// TODO: Consider adding a robust OCR/classifier behind a feature flag if needed.

const TERMS = [
  'nazi',
  'swastika',
  'hitler',
  'ss',
  'third reich',
  'white power',
];

function norm(s = '') {
  return String(s || '').toLowerCase();
}

export function hateTextCheck({ filename, textHints }) {
  const haystack = [norm(filename), norm(textHints)].filter(Boolean).join(' ');
  const blocked = TERMS.some((t) => haystack.includes(t));
  return blocked ? { blocked: true, reason: 'text_hate' } : { blocked: false };
}

export default { hateTextCheck };

