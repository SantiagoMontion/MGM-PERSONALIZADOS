/**
 * Galería de votación: colocá las imágenes en `src/votaciones/`.
 *
 * Convención de nombre de archivo:
 *   `<orden>.<instagram>.<ext>`
 * El handle puede incluir puntos (ej. `39.the_fran.exe.jpeg`).
 * Ejemplos: `1.romanborque.jpg`, `2.elbuendmitry.webp`
 * - El número antes del primer punto define el orden y el id en Supabase: `foto_<orden>`.
 * - El texto entre el primer y el segundo punto es el handle; en la UI se muestra como @handle
 *   (si ya empieza con @, se deja igual).
 *
 * Formatos: jpg, jpeg, png, webp (mayúsculas ok). Podés tener tantas fotos como archivos válidos
 * (hasta el límite de filas en `votacion_galeria_fotos` en Supabase).
 * En el repo: `mgm-front/src/votaciones/` debe estar **sin Git LFS** (ver `.gitattributes` en la raíz),
 * si no el build en la nube a veces empaqueta punteros y las imágenes no cargan.
 */

const FILENAME_RE = /^(\d+)\.(.+)\.(jpe?g|png|webp)$/i;

/**
 * @param {Record<string, { default?: string } | string>} modules
 * @returns {{ id: string, titulo: string, src: string }[]}
 */
function buildGaleriaFotosFromFolder(modules) {
  /** @type {Map<number, { order: number, handle: string, src: string }>} */
  const byOrder = new Map();

  for (const [path, mod] of Object.entries(modules)) {
    const base = path.split(/[/\\]/).pop() ?? '';
    const m = base.match(FILENAME_RE);
    if (!m) continue;

    const order = Number(m[1], 10);
    const handle = (m[2] || '').trim();
    if (!Number.isFinite(order) || order < 1 || !handle) continue;

    const raw = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
    const src = typeof raw === 'string' ? raw : '';
    if (!src) continue;

    if (byOrder.has(order)) continue;

    byOrder.set(order, { order, handle, src });
  }

  return [...byOrder.keys()]
    .sort((a, b) => a - b)
    .map((order) => {
      const row = byOrder.get(order);
      const handle = row.handle;
      const titulo = handle.startsWith('@') ? handle : `@${handle}`;
      return {
        id: `foto_${order}`,
        titulo,
        src: row.src,
      };
    });
}

/** Incluye mayúsculas: en Linux/CI el glob es sensible al caso. */
const galeriaModules = {
  ...import.meta.glob(
    [
      '../votaciones/*.jpg',
      '../votaciones/*.jpeg',
      '../votaciones/*.png',
      '../votaciones/*.webp',
      '../votaciones/*.JPG',
      '../votaciones/*.JPEG',
      '../votaciones/*.PNG',
      '../votaciones/*.WEBP',
    ],
    { eager: true },
  ),
};

export const VOTACION_GALERIA_FOTOS = buildGaleriaFotosFromFolder(galeriaModules);

/** Máximo de fotos distintas que puede votar cada usuario. */
export const VOTACION_GALERIA_MAX_VOTOS = 5;
