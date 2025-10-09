import { createContext, useContext, useState, ReactNode } from 'react';

export type FlowState = {
  productType: 'mousepad' | 'glasspad';
  editorState: any;
  mockupBlob?: Blob;
  mockupUrl?: string;
  printFullResDataUrl?: string;
  fileOriginalUrl?: string | null;
  uploadObjectKey?: string | null;
  originalObjectKey?: string | null;
  uploadBucket?: string | null;
  originalBucket?: string | null;
  uploadDiagId?: string | null;
  rid?: string | null;
  uploadSizeBytes?: number | null;
  uploadContentType?: string | null;
  originalMime?: string | null;
  uploadSha256?: string | null;
  jobId?: string | null;
  designName?: string;
  material?: string;
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
};

const defaultState: Omit<FlowState, 'set' | 'reset'> = {
  productType: 'mousepad',
  editorState: {},
  mockupBlob: undefined,
  mockupUrl: undefined,
  printFullResDataUrl: undefined,
  fileOriginalUrl: undefined,
  uploadObjectKey: undefined,
  originalObjectKey: undefined,
  uploadBucket: undefined,
  originalBucket: undefined,
  uploadDiagId: undefined,
  rid: undefined,
  uploadSizeBytes: undefined,
  uploadContentType: undefined,
  originalMime: undefined,
  uploadSha256: undefined,
  jobId: undefined,
  designName: '',
  material: 'Classic',
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
});

export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(defaultState);
  const revokeIfObjectUrl = (value?: string) => {
    if (typeof value === 'string' && value.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(value);
      } catch {}
    }
  };
  const value: FlowState = {
    ...state,
    set: (p) => setState((s) => {
      if (p && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, 'mockupUrl')) {
        const nextMockupUrl = (p as { mockupUrl?: unknown }).mockupUrl;
        if (typeof s.mockupUrl === 'string'
          && s.mockupUrl
          && nextMockupUrl !== s.mockupUrl) {
          revokeIfObjectUrl(s.mockupUrl);
        }
      }
      return { ...s, ...p };
    }),
    reset: () => {
      revokeIfObjectUrl(state.mockupUrl || undefined);
      setState(defaultState);
    },
  };
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  return useContext(FlowContext);
}
