import { SITE, absoluteUrl, ensureAbsoluteUrl } from './constants.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

export function buildKeywords(extra = []) {
  const set = new Set();
  SITE.keywords.forEach((keyword) => {
    if (keyword) set.add(sanitizeText(keyword));
  });
  extra.forEach((keyword) => {
    const normalized = sanitizeText(keyword);
    if (normalized) set.add(normalized);
  });
  return Array.from(set).filter(Boolean);
}

export function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num - Math.round(num)) < 1e-6) {
    return String(Math.round(num));
  }
  return num.toFixed(1).replace(/\.0+$/, '');
}

export function formatMeasurement(width, height) {
  const w = formatNumber(width);
  const h = formatNumber(height);
  if (!w || !h) return '';
  return `${w} x ${h} cm`;
}

export function describeMaterial(raw) {
  const value = sanitizeText(raw).toLowerCase();
  if (!value) {
    return {
      label: 'Mousepad de tela',
      keywords: ['mousepad de tela personalizado Argentina'],
      narrative:
        'Mousepad gamer de tela con base antideslizante y costuras reforzadas, ideal para sesiones de esports en Argentina.',
      schemaMaterial: 'Tela',
      short: 'Tela premium',
    };
  }

  if (value.includes('glass')) {
    return {
      label: 'Glasspad gamer personalizado',
      keywords: ['Glasspad gamer personalizado', 'glasspad de vidrio templado'],
      narrative:
        'Glasspad gamer personalizado fabricado en vidrio templado de baja fricción para movimientos ultra precisos.',
      schemaMaterial: 'Glass',
      short: 'Glasspad de vidrio templado',
    };
  }

  if (value.includes('pro')) {
    return {
      label: 'Mousepad PRO personalizado',
      keywords: ['mousepad pro personalizado', 'mousepad gamer profesional'],
      narrative:
        'Mousepad gamer PRO con superficie de alto rendimiento y base con agarre firme, confeccionado en Argentina.',
      schemaMaterial: 'Tela PRO',
      short: 'Tela PRO',
    };
  }

  if (value.includes('classic')) {
    return {
      label: 'Mousepad Classic personalizado',
      keywords: ['mousepad classic personalizado', 'mousepad de tela clásico'],
      narrative:
        'Mousepad gamer Classic con textura equilibrada entre velocidad y control, pensado para jugadores argentinos.',
      schemaMaterial: 'Tela Classic',
      short: 'Tela Classic',
    };
  }

  return {
    label: `Mousepad ${sanitizeText(raw)}`,
    keywords: ['mousepad personalizado Argentina'],
    narrative:
      'Mousepad gamer personalizado con materiales seleccionados para brindar estabilidad y precisión en torneos locales.',
    schemaMaterial: sanitizeText(raw),
    short: sanitizeText(raw),
  };
}

export function formatCurrency(value, currency = 'ARS') {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function normalizePrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num.toFixed(2);
}

export function ensureImageUrl(url) {
  return ensureAbsoluteUrl(url || SITE.defaultOgPath);
}

export function canonicalUrl(path) {
  return absoluteUrl(path || '/');
}

export function serializeJsonLd(data) {
  const json = JSON.stringify(data, null, 2);
  return json
    .replace(/<\//g, '\\u003C/')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E');
}
