export function makeErr(code, details = {}) {
  const normalizedCode = typeof code === 'string' && code.trim() ? code.trim() : 'error';
  const error = new Error(normalizedCode);
  error.code = normalizedCode;
  if (details && typeof details === 'object') {
    for (const [key, value] of Object.entries(details)) {
      if (value === undefined) continue;
      error[key] = value;
    }
  }
  return error;
}

export default makeErr;
