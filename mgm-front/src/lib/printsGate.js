import { Buffer } from 'buffer';

const STORAGE_KEY = 'MGM_prints_gate';
export const PRINTS_GATE_PASSWORD = 'Spesia666';
const DURATION_MS = 24 * 60 * 60 * 1000;

function encodePayload(payload) {
  const json = JSON.stringify(payload);
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(json);
  }
  try {
    return Buffer.from(json, 'utf8').toString('base64');
  } catch {
    return json;
  }
}

function decodeStored(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const token = typeof parsed.token === 'string' ? parsed.token : '';
      const expiresAt = Number(parsed.expiresAt);
      if (token && Number.isFinite(expiresAt)) {
        return { token, expiresAt };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function readStoredGate() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return decodeStored(raw);
  } catch (err) {
    console.warn?.('[prints-gate] storage_read_failed', err);
    return null;
  }
}

export function storeGate(record) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn?.('[prints-gate] storage_write_failed', err);
  }
}

export function clearGate() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn?.('[prints-gate] storage_clear_failed', err);
  }
}

export function isGateValid(record) {
  if (!record) return false;
  const now = Date.now();
  return Number.isFinite(record.expiresAt) && record.expiresAt > now;
}

export function createGateRecord() {
  const expiresAt = Date.now() + DURATION_MS;
  const payload = { password: PRINTS_GATE_PASSWORD, expiresAt };
  const token = encodePayload(payload);
  return { token, expiresAt };
}

export function getActiveGateToken() {
  const record = readStoredGate();
  if (isGateValid(record)) {
    return record?.token || '';
  }
  return '';
}

export default {
  readStoredGate,
  storeGate,
  clearGate,
  isGateValid,
  createGateRecord,
  getActiveGateToken,
};
