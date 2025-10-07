const LABEL_KEYWORDS = [
  'nud',
  'sexual',
  'sex',
  'porn',
  'adult',
  'nazi',
  'nazism',
  'swastika',
  'hitler',
  'reich',
  'extrem',
  'hate',
  'symbol',
  'bank',
  'money',
  'currency',
  'cash',
  'bill',
  'banknote',
  'bank_note',
];

const LABEL_ALIASES: Record<string, string> = {
  explicitnudity: 'explicit_nudity',
  explicit_nudity: 'explicit_nudity',
  graphicnudity: 'graphic_nudity',
  graphic_nudity: 'graphic_nudity',
  sexuallyexplicit: 'sexual',
  sexual_content: 'sexual',
  sexualcontent: 'sexual',
  sexual_activity: 'sexual_activity',
  sexualactivity: 'sexual_activity',
  adult: 'adult_content',
  adultcontent: 'adult_content',
  adult_content: 'adult_content',
  pornographic: 'porn',
  pornography: 'porn',
  porn_content: 'porn',
  sexualandminors: 'sexual_minors',
  sexual_minors: 'sexual_minors',
  sexual_minors_content: 'sexual_minors',
  sexualminor: 'sexual_minors',
  sexualminors: 'sexual_minors',
  child_sexual_abuse: 'sexual_minors',
  child_sexual_assault: 'sexual_minors',
  child_exploitation: 'sexual_minors',
  childnudity: 'sexual_minors',
  child_nudity: 'sexual_minors',
  childpornography: 'sexual_minors',
  child_pornography: 'sexual_minors',
  minorssexual: 'sexual_minors',
  minors_sexual: 'sexual_minors',
  nazi: 'nazi',
  nazism: 'nazism',
  nazis: 'nazism',
  nazi_symbol: 'nazi',
  nazi_symbols: 'nazi',
  swastika: 'swastika',
  swastica: 'swastika',
  svastika: 'swastika',
  esvastica: 'swastika',
  esvastika: 'swastika',
  hitler: 'hitler',
  hitlersymbol: 'hitler',
  ss: 'ss_symbol',
  ss_symbol: 'ss_symbol',
  sssymbol: 'ss_symbol',
  thirdreich: 'third_reich',
  third_reich: 'third_reich',
  hate_symbol: 'hate_symbol',
  hate_symbols: 'hate_symbol',
  extremistsymbol: 'extremist_symbol',
  extremist_symbol: 'extremist_symbol',
  extremist_symbols: 'extremist_symbol',
  extremistpropaganda: 'extremist_symbol',
  extremist: 'extremist_symbol',
  extremist_content: 'extremist_symbol',
  extremisticonography: 'extremist_symbol',
  extremisticon: 'extremist_symbol',
  extremistlogo: 'extremist_symbol',
  extremistlogo_symbol: 'extremist_symbol',
  currency: 'currency',
  currencies: 'currency',
  money: 'money',
  cash: 'money',
  banknote: 'banknote',
  banknotes: 'banknote',
  bank_note: 'bank_note',
  bank_notes: 'bank_note',
  banknoteusd: 'banknote',
  banknote_usd: 'banknote',
  banknote_eur: 'banknote',
  banknoteeur: 'banknote',
  banknote_gbp: 'banknote',
  banknotecurrency: 'banknote',
  paper_money: 'money',
  papermoney: 'money',
  money_bill: 'bill',
  moneybill: 'bill',
  dollar_bill: 'bill',
  dollarbill: 'bill',
  euro_bill: 'bill',
  eurobill: 'bill',
};

const MAX_LABEL_LENGTH = 64;

function normalizeString(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const replaced = raw.replace(/[^a-z0-9]+/g, '_');
  const collapsed = replaced.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!collapsed) return null;
  if (collapsed.length > MAX_LABEL_LENGTH) return null;
  const alias = LABEL_ALIASES[collapsed];
  if (alias) return alias;
  return collapsed;
}

function shouldConsider(label: string): boolean {
  for (const keyword of LABEL_KEYWORDS) {
    if (label.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function visit(value: unknown, results: Set<string>, seen: WeakSet<object>) {
  if (value == null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = normalizeString(value);
    if (normalized && shouldConsider(normalized)) {
      results.add(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      visit(entry, results, seen);
    }
    return;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
    const candidateKeys = [
      'label',
      'labels',
      'name',
      'names',
      'category',
      'categories',
      'class',
      'classes',
      'tag',
      'tags',
      'type',
      'types',
      'reason',
      'reasons',
      'value',
      'values',
      'description',
      'descriptions',
      'code',
      'codes',
      'keyword',
      'keywords',
      'concept',
      'concepts',
      'annotation',
      'annotations',
      'labelName',
      'labelNames',
      'moderationLabel',
      'moderationLabels',
      'ModerationLabel',
      'ModerationLabels',
    ];
    for (const key of candidateKeys) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry != null) {
        visit(entry, results, seen);
      }
    }
  }
}

export function normalizeLabels(input: unknown): string[] {
  const results = new Set<string>();
  const seen = new WeakSet<object>();
  visit(input, results, seen);
  return Array.from(results);
}

export function normalizeLabel(input: unknown): string | null {
  const normalized = normalizeString(input);
  if (!normalized) return null;
  if (!shouldConsider(normalized)) return null;
  return normalized;
}

export default { normalizeLabels, normalizeLabel };
