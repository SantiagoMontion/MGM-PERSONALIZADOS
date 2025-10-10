const DEBUG =
  (typeof window !== 'undefined' &&
    (localStorage.getItem('mgm:debug') === '1' ||
      new URLSearchParams(window.location.search).get('mgm_debug') === '1')) ||
  (import.meta.env?.MODE !== 'production' && import.meta.env?.MODE !== 'prod');

export const diag = (...a: any[]) => {
  if (DEBUG) console.debug(...a);
};
export const info = (...a: any[]) => {
  if (DEBUG) console.info(...a);
};
export const warn = (...a: any[]) => console.warn(...a);
export const error = (...a: any[]) => console.error(...a);
export const debugEnabled = DEBUG;
