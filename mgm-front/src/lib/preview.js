export function buildMockupBaseName({ designName, widthCm, heightCm, material }) {
  const base = `${(designName || 'Mousepad').trim()} ${widthCm}x${heightCm} ${material}`.trim();
  return base.replace(/\b(\d+x\d+\s+\w+)\s+\1\b/i, '$1');
}

export function pdfKeyToPreviewKey(pdfKey) {
  const m = pdfKey.match(/^outputs\/pdf-(\d{4}-\d{2})\/(.+)\.pdf$/i);
  if (!m) return null;
  return `preview/mockups-${m[1]}/${m[2]}.png`;
}

export function normalizePreviewUrl(urlOrKey, supaUrl) {
  if (!urlOrKey) return null;
  let key = urlOrKey
    .replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\//, '')
    .replace(/^outputs\/mockups-/i, 'preview/mockups-');
  if (!/^preview\/mockups-\d{4}-\d{2}\//i.test(key)) return null;
  if (!supaUrl) return null;
  const base = supaUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${key}`;
}

export async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}
