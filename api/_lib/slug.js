export function slugifyName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function sizeLabel(w, h) {
  const wInt = Math.round(Number(w));
  const hInt = Math.round(Number(h));
  return `${wInt}x${hInt}`;
}

export function buildObjectKey({ design_name, w_cm, h_cm, material, hash, ext }) {
  const now = new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const slug = slugifyName(design_name);
  const size = sizeLabel(w_cm, h_cm);
  const mat = String(material).toUpperCase();
  const hash8 = String(hash).slice(0, 8);
  return `original/${year}/${mm}/${slug}-${size}-${mat}-${hash8}.${ext}`;
}
