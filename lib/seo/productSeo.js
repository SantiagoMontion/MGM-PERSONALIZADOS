/**
 * SEO title + meta for personalized products created by the editor.
 * Title must differ from the Shopify product title (otherwise Admin stores seo.title as null).
 */

const TITLE_MAX = 60;
const DESC_MAX = 155;

const MATERIAL_COPY = {
  Classic: {
    noun: 'Mousepad Classic',
    blurb:
      'Mousepad Classic personalizado con tela y base de caucho antideslizante, bordes cosidos. Hecho en Argentina. 6 cuotas y envío a todo el país.',
  },
  PRO: {
    noun: 'Mousepad PRO',
    blurb:
      'Mousepad PRO personalizado de alto rendimiento, base de caucho antideslizante y bordes cosidos. Hecho en Argentina. 6 cuotas y envío a todo el país.',
  },
  Ultra: {
    noun: 'Mousepad Ultra',
    blurb:
      'Mousepad Serie Ultra personalizado con base Poron japonés. Rendimiento premium, producción en Argentina. 6 cuotas y envío a todo el país.',
  },
  Glasspad: {
    noun: 'Glasspad',
    blurb:
      'Glasspad gamer personalizado de alto rendimiento para precisión extrema. Línea premium NOTMID. 6 cuotas y envío a todo el país.',
  },
  Alfombra: {
    noun: 'Alfombra',
    blurb:
      'Alfombra personalizada NOTMID para tu espacio o setup. Diseño a medida, producción en Argentina y envío a todo el país.',
  },
  Lámpara: {
    noun: 'Lámpara',
    blurb:
      'Lámpara personalizada NOTMID. Diseño a medida, producción en Argentina. Consultá envíos a todo el país.',
  },
};

function cleanSpaces(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, max) {
  const text = cleanSpaces(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1).replace(/\s+\S*$/, '');
  return `${(cut || text.slice(0, max - 1)).replace(/[ ,|\-]+$/g, '')}…`;
}

export function normalizeSeoMaterial(raw) {
  const text = cleanSpaces(raw).toLowerCase();
  if (!text) return 'Classic';
  if (text === 'pro') return 'PRO';
  if (text === 'classic' || text === 'clasic') return 'Classic';
  if (text.includes('ultra')) return 'Ultra';
  if (text.includes('glass')) return 'Glasspad';
  if (text.includes('alfombr')) return 'Alfombra';
  if (text.includes('lamp') || text.includes('ilumin')) return 'Lámpara';
  if (text === 'pro' || /\bpro\b/.test(text)) return 'PRO';
  return 'Classic';
}

function designCore(designName) {
  return cleanSpaces(designName)
    .replace(/\s*\|\s*Custom(?:-recto)?\s*$/i, '')
    .replace(/\s*\|\s*NOTMID(?:\s+Argentina)?\s*$/i, '')
    .trim();
}

/**
 * @param {object} opts
 * @param {string} [opts.material]
 * @param {string} [opts.designName]
 * @param {string} [opts.measurement] e.g. "90x40"
 * @param {string} [opts.productTitle] Shopify product title (to keep SEO title distinct)
 * @param {string} [opts.seoTitle] optional override from client
 * @param {string} [opts.seoDescription] optional override from client
 */
export function buildPersonalizedProductSeo(opts = {}) {
  const material = normalizeSeoMaterial(opts.material);
  const copy = MATERIAL_COPY[material] || MATERIAL_COPY.Classic;
  const design = designCore(opts.designName);
  const measurement = cleanSpaces(opts.measurement);
  const productTitle = cleanSpaces(opts.productTitle);

  const titleParts = [];
  if (design) titleParts.push(design);
  titleParts.push(copy.noun);
  if (measurement && material !== 'Ultra') titleParts.push(measurement);
  let title = truncate(`${titleParts.join(' ')} | NOTMID`, TITLE_MAX);

  // Shopify drops seo.title when it equals the product title.
  if (productTitle && title.toLowerCase() === productTitle.toLowerCase()) {
    title = truncate(`${titleParts.join(' ')} | NOTMID Argentina`, TITLE_MAX);
  }

  let description = cleanSpaces(opts.seoDescription);
  if (!description) {
    const lead = design
      ? `${copy.noun} ${design}${measurement ? ` ${measurement}` : ''} de NOTMID.`
      : `${copy.noun} personalizado de NOTMID.`;
    description = truncate(`${lead} ${copy.blurb}`, DESC_MAX);
  } else {
    description = truncate(description, DESC_MAX);
  }

  const overrideTitle = cleanSpaces(opts.seoTitle);
  if (overrideTitle) {
    const candidate = truncate(overrideTitle, TITLE_MAX);
    if (!productTitle || candidate.toLowerCase() !== productTitle.toLowerCase()) {
      title = candidate;
    }
  }

  return { title, description, material };
}
