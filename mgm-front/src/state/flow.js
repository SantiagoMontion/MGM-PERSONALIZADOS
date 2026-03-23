import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const FLOW_STORAGE_KEY = 'mgm_flow_v1';
const PERSIST_KEYS = [
  'material',
  'isCircular',
  'shape',
  'widthCm',
  'heightCm',
  'options',
  'mockupUrl',
  'mockupPublicUrl',
  'mockupHash',
  'lastProduct',
  'priceTransfer',
  'priceNormal',
  'priceCurrency',
];

const asStr = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const safeStr = (value, fallback = '') => {
  const str = asStr(value).trim();
  return str || fallback;
};
const normalizeMaterial = (value) => {
  const normalized = safeStr(value).toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('ultra')) return 'Ultra';
  if (normalized.includes('pro')) return 'PRO';
  if (normalized.includes('alfombr')) return 'Alfombra';
  return normalized ? 'Classic' : '';
};
const normalizeShape = (value) => (
  safeStr(value).toLowerCase() === 'circle' ? 'circle' : 'rounded_rect'
);
const isBlobUrl = (value) => typeof value === 'string' && value.startsWith('blob:');
const revokeObjectUrl = (value) => {
  if (!isBlobUrl(value)) return;
  try {
    URL.revokeObjectURL(value);
  } catch {
    // ignore
  }
};
const buildImageAssetPatch = (nextAssetInput, prevState) => {
  const prevAsset = prevState?.uploadedAsset || null;
  const nextAssetRaw =
    typeof nextAssetInput === 'function' ? nextAssetInput(prevAsset) : nextAssetInput;

  if (!nextAssetRaw) {
    return {
      uploadedAsset: null,
      masterFile: null,
      imageLocalUrl: null,
      imageSourceUrl: null,
      fileOriginalUrl: null,
    };
  }

  const nextAsset = {
    ...(prevAsset && typeof prevAsset === 'object' ? prevAsset : {}),
    ...nextAssetRaw,
  };
  const localUrl = safeStr(nextAsset.localUrl) || null;
  const canonicalUrl = safeStr(nextAsset.canonical_url || nextAsset.file_original_url) || null;
  const imageSourceUrl = localUrl || canonicalUrl || safeStr(nextAsset.imageUrl) || null;

  return {
    uploadedAsset: nextAsset,
    masterFile: nextAsset.file ?? null,
    imageLocalUrl: localUrl,
    imageSourceUrl,
    fileOriginalUrl: canonicalUrl,
  };
};

const defaultState = {
  productType: 'mousepad',
  editorState: null,
  uploadedAsset: null,
  masterFile: null,
  imageLocalUrl: null,
  imageSourceUrl: null,
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
  isCircular: false,
  shape: 'rounded_rect',
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
  get: () => defaultState,
  set: () => {},
  setImageAsset: () => {},
  clearImageAsset: () => {},
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
          if (key === 'priceTransfer' || key === 'priceNormal') {
            const num = Number(parsed[key]);
            if (Number.isFinite(num) && num > 0) {
              next[key] = num;
            }
            return;
          }
          if (key === 'priceCurrency') {
            const curr = safeStr(parsed[key], 'ARS');
            if (curr) next[key] = curr;
            return;
          }
          if (key === 'options') {
            const opts = parsed.options;
            if (opts && typeof opts === 'object') {
              next.options = { ...(defaultState.options || {}), ...opts };
              if (opts.material) {
                next.options.material = safeStr(opts.material);
              }
              if ('shape' in opts) {
                next.options.shape = normalizeShape(opts.shape);
              }
              if ('isCircular' in opts) {
                next.options.isCircular = Boolean(opts.isCircular);
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
          if (key === 'shape') {
            next.shape = normalizeShape(parsed.shape);
            return;
          }
          if (key === 'isCircular') {
            next.isCircular = Boolean(parsed.isCircular);
            return;
          }
          next[key] = parsed[key];
        });
      }
      if (next.material === 'Glasspad' || next.material === 'Ultra') {
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
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
            payload.options = {
              ...(matValue ? { material: matValue } : {}),
              shape: normalizeShape(value.shape || state.shape),
              isCircular: Boolean(value.isCircular ?? state.isCircular),
            };
          }
          return;
        }
        if (key === 'priceTransfer' || key === 'priceNormal') {
          const num = Number(value);
          if (Number.isFinite(num) && num > 0) {
            payload[key] = num;
          }
          return;
        }
        if (key === 'priceCurrency') {
          const curr = safeStr(value, 'ARS');
          if (curr) payload[key] = curr;
          return;
        }
        if (key === 'shape') {
          payload[key] = normalizeShape(value);
          return;
        }
        if (key === 'isCircular') {
          payload[key] = Boolean(value);
          return;
        }
        payload[key] = key === 'material' ? normalizeMaterial(value) || state.material : value;
      });
      window.localStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[flow] persist_failed', error);
    }
  }, [
    state.material,
    state.isCircular,
    state.shape,
    state.widthCm,
    state.heightCm,
    state.options,
    state.mockupUrl,
    state.mockupPublicUrl,
    state.mockupHash,
    state.priceTransfer,
    state.priceNormal,
    state.priceCurrency,
    state.lastProduct,
  ]);

  const set = useCallback((partial) => {
    setState((prev) => {
      const nextPartial = typeof partial === 'function' ? partial(prev) : partial;
      if (!nextPartial || typeof nextPartial !== 'object') return prev;
      return { ...prev, ...nextPartial };
    });
  }, []);

  const setImageAsset = useCallback((nextAssetInput) => {
    setState((prev) => {
      const previousLocalUrl = prev.imageLocalUrl || prev.uploadedAsset?.localUrl || null;
      const patch = buildImageAssetPatch(nextAssetInput, prev);
      const nextLocalUrl = patch.imageLocalUrl;

      if (previousLocalUrl && previousLocalUrl !== nextLocalUrl) {
        revokeObjectUrl(previousLocalUrl);
      }

      return {
        ...prev,
        ...patch,
      };
    });
  }, []);

  const clearImageAsset = useCallback(() => {
    setImageAsset(null);
  }, [setImageAsset]);

  const reset = useCallback(() => {
    const currentState = stateRef.current || defaultState;
    revokeObjectUrl(currentState.mockupUrl);
    revokeObjectUrl(currentState.imageLocalUrl || currentState.uploadedAsset?.localUrl);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(FLOW_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    setState({ ...defaultState });
  }, []);

  const value = {
    ...state,
    get: () => stateRef.current || defaultState,
    set,
    setImageAsset,
    clearImageAsset,
    reset,
  };
  return React.createElement(FlowContext.Provider, { value }, children);
}

export function useFlow() {
  return useContext(FlowContext);
}
