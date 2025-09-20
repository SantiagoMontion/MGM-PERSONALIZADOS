function sanitizeName(s = '') {
  return s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function formatDimension(value: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  const fixed = numeric.toFixed(2);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function buildExportBaseName(
  designName: string,
  w_cm: number,
  h_cm: number,
  material?: string | null,
) {
  const cleanName = sanitizeName(designName || 'Diseño');
  const cleanMaterial = sanitizeName(material || '');
  const measurement = `${formatDimension(w_cm)}x${formatDimension(h_cm)}`;
  return cleanMaterial ? `${cleanName} ${measurement} ${cleanMaterial}` : `${cleanName} ${measurement}`;
}
