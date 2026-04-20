const STORAGE_VOTER = 'mgm_votacion_galeria_voter_uuid';
const STORAGE_DONE = 'mgm_votacion_galeria_completado';

function randomUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** UUID persistente por navegador (localStorage). */
export function getOrCreateVoterUuid() {
  if (typeof window === 'undefined') return randomUuid();
  try {
    const existing = window.localStorage.getItem(STORAGE_VOTER);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const created = randomUuid();
    window.localStorage.setItem(STORAGE_VOTER, created);
    return created;
  } catch {
    return randomUuid();
  }
}

export function isGaleriaCompletedLocal() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_DONE) === '1';
  } catch {
    return false;
  }
}

export function setGaleriaCompletedLocal() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_DONE, '1');
  } catch {
    /* ignore */
  }
}

export function clearGaleriaCompletedLocal() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_DONE);
  } catch {
    /* ignore */
  }
}

/** SHA-256 hex de la IP pública (para deduplicar por red; el cliente obtiene la IP vía API). */
export async function getPublicIpHashHex() {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    const ip = String(j?.ip ?? '').trim();
    if (!ip.length) return '';
    const enc = new TextEncoder().encode(ip);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}
