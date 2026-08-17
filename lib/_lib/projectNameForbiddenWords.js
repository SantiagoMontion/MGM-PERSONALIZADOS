/** Palabras no permitidas en el nombre del proyecto (si aparecen en cualquier parte). */
export const PROJECT_NAME_FORBIDDEN_WORDS = [
  'ultra',
  'classic',
  'pro',
  'alfombra',
  'glasspad',
  'teclado',
  'mouse',
  'keycap',
  'monitor',
  'cable',
  'auricular',
  'auriculares',
];

export const PROJECT_NAME_FORBIDDEN_WORDS_MESSAGE =
  'No podés usar estas palabras en el nombre del proyecto: ultra, classic, pro, alfombra, glasspad, teclado, mouse, keycap, monitor, cable, auricular, auriculares.';

/**
 * Normaliza para comparar: minúsculas + sin acentos.
 * @param {string} value
 */
function normalizeForForbiddenCheck(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * True si alguna palabra prohibida aparece en cualquier parte del nombre.
 * Ej: "mouse", "Mouse", "mousepad", "super mouse" → bloqueado.
 * @param {string} value
 */
export function projectNameContainsForbiddenWord(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const haystack = normalizeForForbiddenCheck(value);
  for (const word of PROJECT_NAME_FORBIDDEN_WORDS) {
    const needle = normalizeForForbiddenCheck(word);
    if (needle && haystack.includes(needle)) return true;
  }
  return false;
}
