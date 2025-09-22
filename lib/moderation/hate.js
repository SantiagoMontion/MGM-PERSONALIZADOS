// Text-only hate symbol/term checker for server runtime (no heavy image libs)
// TODO: Consider adding a robust OCR/classifier behind a feature flag if needed.

const RAW_TERMS = [
  'nazi',
  'nazis',
  'nazismo',
  'nazism',
  'nazista',
  'nacionalsocialista',
  'neonazi',
  'neo nazi',
  'neo-nazi',
  'hitler',
  'adolf hitler',
  'adolfhitler',
  'heil hitler',
  'heilhitler',
  'sieg heil',
  'siegheil',
  'swastika',
  'swastica',
  'svastica',
  'svastika',
  'esvastica',
  'esvasticas',
  'esvastika',
  'esvastikas',
  'esvástica',
  'esvásticas',
  'führer',
  'fuhrer',
  'third reich',
  'thirdreich',
  'white power',
  'whitepower',
  'reichsadler',
  'schutzstaffel',
  'hitlerjugend',
  '1488',
  '14/88',
  'fourteen words',
  '14 words',
  'stormfront',
  'blood and soil',
  'blut und boden',
  'white pride worldwide',
  'wpww',
  'aryan brotherhood',
];

function norm(input = '') {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

const TERMS = RAW_TERMS.map(norm);

export function hateTextCheck({ filename, textHints, designName }) {
  const haystack = [filename, designName, textHints]
    .map(norm)
    .filter(Boolean)
    .join(' ');
  const match = TERMS.find((t) => haystack.includes(t));
  return match ? { blocked: true, reason: 'text_hate', term: match } : { blocked: false };
}

export default { hateTextCheck };

