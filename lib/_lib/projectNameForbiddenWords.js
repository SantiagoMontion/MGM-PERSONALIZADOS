/** Palabras no permitidas como término completo en el nombre del proyecto. */
export const PROJECT_NAME_FORBIDDEN_WORDS = ['pro', 'classic', 'ultra', 'alfombra'];

export const PROJECT_NAME_FORBIDDEN_WORDS_MESSAGE =
  'No podés usar las palabras pro, classic, ultra ni alfombra en el nombre del proyecto.';

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detecta si alguna palabra prohibida aparece como palabra completa (no como parte de otra palabra).
 * @param {string} value
 */
export function projectNameContainsForbiddenWord(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const lower = value.toLowerCase();
  for (const word of PROJECT_NAME_FORBIDDEN_WORDS) {
    const re = new RegExp(
      `(^|[^\\p{L}])${escapeRegExp(word)}($|[^\\p{L}])`,
      'u',
    );
    if (re.test(lower)) return true;
  }
  return false;
}
