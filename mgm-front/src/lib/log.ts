const debugStorageFlag = (() => {
  if (typeof window === 'undefined') return false;

  try {
    return localStorage.getItem('mgm:debug') === '1';
  } catch {
    return false;
  }
})();

const DEBUG =
  (typeof window !== 'undefined' &&
    (debugStorageFlag ||
      new URLSearchParams(window.location.search).get('mgm_debug') === '1')) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE && import.meta.env.MODE !== 'production');

export const diag = (...a: any[]) => { if (DEBUG) console.debug(...a); };
export const info = (...a: any[]) => { if (DEBUG) console.info(...a); };
export const warn = (...a: any[]) => console.warn(...a);
export const error = (...a: any[]) => console.error(...a);
export const debugEnabled = DEBUG;
