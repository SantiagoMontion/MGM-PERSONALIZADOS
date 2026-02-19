export function buildMockupBaseName({ designName, widthCm, heightCm, material }) {
  const base = `${(designName || 'Mousepad').trim()} ${widthCm}x${heightCm} ${material}`.trim();
  return base.replace(/\b(\d+x\d+\s+\w+)\s+\1\b/i, '$1');
}

export function pdfKeyToPreviewKey(pdfKey) {
  if (typeof pdfKey !== 'string') return null;
  const normalized = pdfKey
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^storage\/v1\/object\/public\//i, '')
    .replace(/^\/+/, '');
  if (!normalized) return null;

  let monthFolder = null;
  let rawFilename = null;

  let m = normalized.match(/^(?:outputs\/)?pdf-(\d{4}-\d{2})\/(.+)\.pdf(?:$|[?#])/i);
  if (m) {
    monthFolder = m[1];
    rawFilename = m[2];
  }

  if (!monthFolder || !rawFilename) {
    m = normalized.match(/^(?:outputs\/)?pdf\/(\d{4})\/(\d{2})\/(.+)\.pdf(?:$|[?#])/i);
    if (m) {
      monthFolder = `${m[1]}-${m[2]}`;
      rawFilename = m[3];
    }
  }

  if (!monthFolder || !rawFilename) return null;

  const dedupedFilename = rawFilename
    .replace(/-(\d{1,3}x\d{1,3})-([^-/]+)-\1-\2$/i, '-$1-$2')
    .replace(/-(\d{1,3}x\d{1,3})-([^-/]+)-\1-/i, '-$1-$2-')
    .replace(/-{2,}/g, '-');

  return `preview/mockups-${monthFolder}/${dedupedFilename}.png`;
}

export function normalizePreviewUrl(urlOrKey, supaUrl) {
  if (!urlOrKey || !supaUrl) return null;

  const bucket = (import.meta.env?.VITE_PREVIEW_STORAGE_BUCKET || 'preview')
    .replace(/^\/+|\/+$/g, '');
  const base = supaUrl.replace(/\/+$/, '');

  let key = urlOrKey
    .replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\//, '')
    .replace(/^outputs\/mockups-/i, `${bucket}/mockups-`)
    .replace(/^preview\//i, '')
    .replace(/^mockups\//i, '')
    .replace(new RegExp(`^${bucket}/`, 'i'), '');

  const previewPath = key.startsWith('preview/mockups-')
    ? key.replace(/^preview\//i, '')
    : key;

  if (!/^mockups-\d{4}-\d{2}\//i.test(previewPath)) return null;

  return `${base}/storage/v1/object/public/${bucket}/${previewPath}`;
}

export async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}
