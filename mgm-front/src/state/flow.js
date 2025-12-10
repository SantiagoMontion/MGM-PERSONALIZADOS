import React, { createContext, useContext, useEffect, useState } from 'react';

const FLOW_STORAGE_KEY = 'mgm_flow_v1';
const PERSIST_KEYS = [
  'designName',
  'material',
  'widthCm',
  'heightCm',
  'options',
  'mockupUrl',
  'mockupPublicUrl',
  'mockupHash',
];

const asStr = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const safeStr = (value, fallback = '') => {
  const str = asStr(value).trim();
  return str || fallback;
};
const normalizeMaterial = (value) => {
  const normalized = safeStr(value).toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('pro')) return 'PRO';
  if (normalized.includes('alfombr')) return 'Alfombra';
  return normalized ? 'Classic' : '';
};

const defaultState = {
  productType: 'mousepad',
  editorState: null,
  mockupBlob: null,
  mockupUrl: null,
  mockupPublicUrl: null,
  mockupHash: null,
  mockupUploadOk: false,
  mockupUploadError: null,
  masterBytes: null,
  printFullResDataUrl: null,
  fileOriginalUrl: null,
  uploadObjectKey: null,
  uploadBucket: null,
  uploadDiagId: null,
  uploadSizeBytes: null,
  uploadContentType: null,
  uploadSha256: null,
  jobId: null,
  designName: '',
  material: null,
  options: {},
  widthCm: null,
  heightCm: null,
  lowQualityAck: false,
  approxDpi: null,
  priceTransfer: 0,
  priceNormal: 0,
  priceCurrency: 'ARS',
  customerEmail: '',
  lastProduct: null,
};

const FlowContext = createContext({
  ...defaultState,
  set: () => {},
  reset: () => {},
});

export function FlowProvider({ children }) {
  const loadInitial = () => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...defaultState };
    }
    try {
      const raw = window.localStorage.getItem(FLOW_STORAGE_KEY);
      if (!raw) {
        return { ...defaultState };
      }
      const parsed = JSON.parse(raw);
      const next = { ...defaultState };
      if (parsed && typeof parsed === 'object') {
        PERSIST_KEYS.forEach((key) => {
          if (!(key in parsed)) return;
          if (key === 'widthCm' || key === 'heightCm') {
            const num = Number(parsed[key]);
            if (Number.isFinite(num) && num > 0) {
              next[key] = Math.round(num);
            }
            return;
          }
          if (key === 'options') {
            const opts = parsed.options;
            if (opts && typeof opts === 'object') {
              next.options = { ...(defaultState.options || {}), ...opts };
              if (opts.material) {
                next.options.material = safeStr(opts.material);
              }
            }
            return;
          }
          if (key === 'material') {
            const normalized = normalizeMaterial(parsed.material);
            if (normalized) {
              next.material = normalized;
            }
            return;
          }
          next[key] = parsed[key];
        });
      }
      if (next.material === 'Glasspad') {
        if (!(Number.isFinite(next.widthCm) && next.widthCm > 0)) {
          next.widthCm = 49;
        }
        if (!(Number.isFinite(next.heightCm) && next.heightCm > 0)) {
          next.heightCm = 42;
        }
      }
      console.log('[audit:flow:hydrate]', {
        widthCm: next.widthCm,
        heightCm: next.heightCm,
        material: next.material,
        designName: next.designName,
      });
      return next;
    } catch (error) {
      console.warn('[flow] hydrate_failed', error);
      return { ...defaultState };
    }
  };

  const [state, setState] = useState(loadInitial);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const payload = {};
      PERSIST_KEYS.forEach((key) => {
        if (!(key in state)) return;
        const value = state[key];
        if (value == null) return;
        if (key === 'widthCm' || key === 'heightCm') {
          const num = Number(value);
          if (Number.isFinite(num) && num > 0) {
            payload[key] = Math.round(num);
          }
          return;
        }
        if (key === 'options') {
          if (value && typeof value === 'object') {
            const matValue = safeStr(value.material || state.material);
            if (matValue) {
              payload.options = { material: matValue };
            }
          }
          return;
        }
        payload[key] = key === 'material' ? normalizeMaterial(value) || state.material : value;
      });
      window.localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[flow] persist_failed', error);
    }
  }, [
    state.designName,
    state.material,
    state.widthCm,
    state.heightCm,
    state.options,
    state.mockupUrl,
    state.mockupPublicUrl,
    state.mockupHash,
  ]);

  const value = {
    ...state,
    set: (partial) => setState((s) => ({ ...s, ...partial })),
    reset: () => {
      try {
        if (state.mockupUrl) URL.revokeObjectURL(state.mockupUrl);
      } catch {
        // ignore
      }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(FLOW_STORAGE_KEY);
        }
      } catch {
        // ignore
      }
      setState({ ...defaultState });
    },
  };
  return React.createElement(FlowContext.Provider, { value }, children);
}

export function useFlow() {
  return useContext(FlowContext);
}
