export function createDiagId() {
  const base = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${base}${random}`;
}

export function logApiError(label, payload = {}) {
  const { diagId, step, error } = payload || {};
  const normalizedError = typeof error === 'string' ? error : error?.message || error;
  try {
    console.error(`[${label}]`, {
      ...(diagId ? { diagId } : {}),
      ...(step ? { step } : {}),
      error: normalizedError,
    });
  } catch {}
}

export default { createDiagId, logApiError };
