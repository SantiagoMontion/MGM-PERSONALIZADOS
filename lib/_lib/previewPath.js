import { slugifyName } from './slug.js';

const DEFAULT_NAME = 'Design';

function normalizeCandidate(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\.[^./\\]+$/, '');
}

export function safeName(value) {
  const cleaned = normalizeCandidate(value)
    .replace(/[-_]+/g, ' ')
    .replace(/[\s]+/g, ' ')
    .replace(/[\/\\:*?"<>|]+/g, ' ')
    .trim();
  return cleaned || DEFAULT_NAME;
}

export function materialLabel(material) {
  const input = typeof material === 'string' ? material : Array.isArray(material) ? material.join(' ') : '';
  const normalized = input.toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('pro')) return 'PRO';
  if (normalized.includes('classic')) return 'Classic';
  return input.trim() || 'Classic';
}

export function yyyymm(input) {
  const date = input ? new Date(input) : new Date();
  if (Number.isNaN(date.getTime())) {
    return yyyymm(new Date());
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

export function mmToCm(mm) {
  const value = Number(mm);
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value / 10);
  }
  return null;
}

export function extractDims(source) {
  const match = String(source || '').match(/(\d+)\s*[xX]\s*(\d+)/);
  if (!match) {
    return { wCm: null, hCm: null };
  }
  return { wCm: Number(match[1]) || null, hCm: Number(match[2]) || null };
}

export function resolveDimensions(row) {
  const mmWidths = [row?.masterWidthMm, row?.master_width_mm, row?.widthMm, row?.width_mm];
  const mmHeights = [row?.masterHeightMm, row?.master_height_mm, row?.heightMm, row?.height_mm];
  const mmWidth = mmWidths.find((value) => Number.isFinite(Number(value)));
  const mmHeight = mmHeights.find((value) => Number.isFinite(Number(value)));
  let widthCm = mmToCm(mmWidth);
  let heightCm = mmToCm(mmHeight);

  if (!widthCm || !heightCm) {
    const cmWidth = Number(row?.widthCm ?? row?.width_cm);
    const cmHeight = Number(row?.heightCm ?? row?.height_cm);
    if (Number.isFinite(cmWidth) && Number.isFinite(cmHeight) && cmWidth > 0 && cmHeight > 0) {
      widthCm = cmWidth;
      heightCm = cmHeight;
    }
  }

  if (!widthCm || !heightCm) {
    const measureSources = [row?.measure, row?.title, row?.designName, row?.design_name, row?.slug, row?.name];
    for (const source of measureSources) {
      const { wCm, hCm } = extractDims(source);
      if (wCm && hCm) {
        widthCm = wCm;
        heightCm = hCm;
        break;
      }
    }
  }

  return { widthCm: widthCm || null, heightCm: heightCm || null };
}

export function buildMockupFileName({ designName, widthCm, heightCm, material }) {
  const safeDesign = safeName(designName);
  const designSlug = slugifyName(safeDesign) || safeDesign.replace(/\s+/g, '-').toLowerCase();
  const materialTag = materialLabel(material);
  const materialSlug = slugifyName(materialTag) || materialTag.replace(/\s+/g, '-').toLowerCase();
  return `${designSlug}-${widthCm}x${heightCm}-${materialSlug}.png`;
}

export function buildMockupPath({ designName, widthCm, heightCm, material, createdAt }) {
  const folder = `mockups-${yyyymm(createdAt)}`;
  const file = buildMockupFileName({ designName, widthCm, heightCm, material });
  return `${folder}/${file}`;
}

function resolveMaterial(row) {
  if (row?.material) return row.material;
  if (row?.options && typeof row.options === 'object') {
    const opts = row.options;
    if (typeof opts.material === 'string') return opts.material;
    if (typeof opts?.mockup?.material === 'string') return opts.mockup.material;
  }
  if (Array.isArray(row?.tags)) {
    return row.tags.join(' ');
  }
  if (typeof row?.tags === 'string') {
    return row.tags;
  }
  return 'Classic';
}

function resolveDesign(row) {
  const candidates = [
    row?.designName,
    row?.design_name,
    row?.title,
    row?.name,
    row?.fileName,
    row?.slug,
  ];
  for (const value of candidates) {
    const normalized = safeName(value);
    if (normalized && normalized !== DEFAULT_NAME) {
      return normalized;
    }
  }
  return DEFAULT_NAME;
}

export function publicUrlForMockup(row) {
  if (!row) return null;
  const { widthCm, heightCm } = resolveDimensions(row);
  if (!widthCm || !heightCm) {
    return null;
  }
  const designName = resolveDesign(row);
  const material = resolveMaterial(row);
  const createdAt = row?.createdAt || row?.created_at || row?.updatedAt || row?.updated_at;
  const bucket = process.env.PREVIEW_STORAGE_BUCKET || 'preview';
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) {
    return null;
  }
  const path = buildMockupPath({
    designName,
    widthCm,
    heightCm,
    material,
    createdAt,
  });
  return `${base}/storage/v1/object/public/${bucket}/${encodeURI(path)}`;
}

export default publicUrlForMockup;
