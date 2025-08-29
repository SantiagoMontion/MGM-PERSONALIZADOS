function sanitizeName(s='') {
  return s.replace(/[\\/:*?"<>|]+/g,' ')
          .replace(/\s+/g,' ')
          .trim()
          .slice(0, 80);
}
export function buildExportBaseName(designName: string, w_cm: number, h_cm: number) {
  const clean = sanitizeName(designName || 'Diseño');
  return `${clean} ${Number(w_cm)}x${Number(h_cm)}`;
}
