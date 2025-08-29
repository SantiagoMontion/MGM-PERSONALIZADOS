export const DEBUG = import.meta.env.DEV && import.meta.env.VITE_DEBUG_UI === '1';
export const dlog = (...a: any[]) => { if (DEBUG) console.log(...a); };
