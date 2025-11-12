export function buildMockupBaseName({ designName, widthCm, heightCm, material }: {
  designName: string; widthCm: number; heightCm: number; material: string;
}) {
  const base = `${(designName || 'Mousepad').trim()} ${widthCm}x${heightCm} ${material}`.trim();
  // quita duplicaciones típicas "90x40 Classic 90x40 Classic"
  return base.replace(/\b(\d+x\d+\s+\w+)\s+\1\b/i, '$1');
}

export function pdfKeyToPreviewKey(pdfKey: string) {
  // outputs/pdf-YYYY-MM/<base>.pdf  ->  preview/mockups-YYYY-MM/<base>.png
  const m = pdfKey.match(/^outputs\/pdf-(\d{4}-\d{2})\/(.+)\.pdf$/i);
  if (!m) return null;
  return `preview/mockups-${m[1]}/${m[2]}.png`;
}

export function normalizePreviewUrl(urlOrKey: string, supaUrl: string) {
  if (!urlOrKey) return null;
  // Corrige bucket mal puesto
  let key = urlOrKey
    .replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/public\//, '') // deja solo el key
    .replace(/^outputs\/mockups-/i, 'preview/mockups-');
  if (!/^preview\/mockups-\d{4}-\d{2}\//i.test(key)) return null;
  if (!supaUrl) return null;
  const base = supaUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${key}`;
}

export async function headOk(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}
