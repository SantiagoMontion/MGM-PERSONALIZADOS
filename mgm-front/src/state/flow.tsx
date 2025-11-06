import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const FLOW_STORAGE_KEY = 'mgm_flow_v1';
const PERSIST_KEYS = [
  'designName',
  'material',
  'widthCm',
  'heightCm',
  'options',
  'mockupUrl',
  'mockupPublicUrl',
];

const asStr = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value == null ? fallback : String(value);
const safeStr = (value: unknown, fallback = ''): string => {
  const str = asStr(value, fallback).trim();
  return str || fallback;
};
const normalizeMaterial = (value: unknown): 'Glasspad' | 'PRO' | 'Classic' | '' => {
  const normalized = safeStr(value).toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('pro')) return 'PRO';
  return normalized ? 'Classic' : '';
};

export type FlowState = {
  productType: 'mousepad' | 'glasspad';
  editorState: any;
  mockupBlob?: Blob;
  mockupUrl?: string;
  mockupPublicUrl?: string;
  mockupV?: string | null;
  printFullResDataUrl?: string;
  fileOriginalUrl?: string | null;
  uploadObjectKey?: string | null;
  uploadBucket?: string | null;
  uploadDiagId?: string | null;
  uploadSizeBytes?: number | null;
  uploadContentType?: string | null;
  uploadSha256?: string | null;
  jobId?: string | null;
  designName?: string;
  material?: string;
  options?: Record<string, unknown> | null;
  widthCm?: number | null;
  heightCm?: number | null;
  lowQualityAck?: boolean;
  approxDpi?: number | null;
  priceTransfer?: number;
  priceNormal?: number;
  priceCurrency?: string;
  customerEmail?: string;
  lastProduct?: {
    productId?: string;
    variantId?: string;
    variantIdNumeric?: string;
    variantIdGid?: string;
    cartUrl?: string;
    checkoutUrl?: string;
    productUrl?: string;
    productHandle?: string;
    visibility?: 'public' | 'private';
    draftOrderId?: string;
    draftOrderName?: string;
    warnings?: any[];
    warningMessages?: string[];
  };
  set: (p: Partial<FlowState>) => void;
  reset: () => void;
  setMockupVersion?: (v?: string | null) => void;
  clearMockupVersion?: () => void;
};

const defaultState: Omit<FlowState, 'set' | 'reset'> = {
  productType: 'mousepad',
  editorState: {},
  mockupBlob: undefined,
  mockupUrl: undefined,
  mockupPublicUrl: undefined,
  mockupV: null,
  printFullResDataUrl: undefined,
  fileOriginalUrl: undefined,
  uploadObjectKey: undefined,
  uploadBucket: undefined,
  uploadDiagId: undefined,
  uploadSizeBytes: undefined,
  uploadContentType: undefined,
  uploadSha256: undefined,
  jobId: undefined,
  designName: '',
  material: 'Classic',
  options: {},
  widthCm: null,
  heightCm: null,
  lowQualityAck: false,
  approxDpi: null,
  priceTransfer: 0,
  priceNormal: 0,
  priceCurrency: 'ARS',
  customerEmail: '',
  lastProduct: undefined,
};

const FlowContext = createContext<FlowState>({
  ...defaultState,
  set: () => {},
  reset: () => {},
  setMockupVersion: () => {},
  clearMockupVersion: () => {},
});

export function FlowProvider({ children }: { children: ReactNode }) {
  const loadInitial = (): typeof defaultState => {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...defaultState };
    }
    try {
      const raw = window.localStorage.getItem(FLOW_STORAGE_KEY);
      if (!raw) {
        return { ...defaultState };
      }
      const parsed = JSON.parse(raw);
      const next: typeof defaultState = { ...defaultState };
      if (parsed && typeof parsed === 'object') {
        PERSIST_KEYS.forEach((key) => {
          if (!(key in parsed)) return;
          if (key === 'widthCm' || key === 'heightCm') {
            const num = Number(parsed[key]);
            if (Number.isFinite(num) && num > 0) {
              (next as any)[key] = Math.round(num);
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
          (next as any)[key] = parsed[key];
        });
      }
      if (next.material === 'Glasspad') {
        next.widthCm = 49;
        next.heightCm = 42;
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
  const value: FlowState = {
    ...state,
    set: (p) => setState((s) => ({ ...s, ...p })),
    reset: () => {
      if (state.mockupUrl) URL.revokeObjectURL(state.mockupUrl);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(FLOW_STORAGE_KEY);
        }
      } catch {
        // ignore
      }
      setState(defaultState);
    },
    setMockupVersion: (v) => {
      setState((s) => ({ ...s, mockupV: v || null }));
    },
    clearMockupVersion: () => {
      setState((s) => ({ ...s, mockupV: null }));
    },
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const payload: Record<string, unknown> = {};
      PERSIST_KEYS.forEach((key) => {
        if (!(key in state)) return;
        const value = (state as any)[key];
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
            payload.options = { material: safeStr((value as any).material || state.material) };
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
  ]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  return useContext(FlowContext);
}
