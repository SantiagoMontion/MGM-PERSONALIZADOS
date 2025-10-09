import { createContext, useContext, useState, ReactNode } from 'react';

export type FlowState = {
  productType: 'mousepad' | 'glasspad';
  editorState: any;
  mockupBlob?: Blob;
  mockupUrl?: string;
  mockup?: {
    dataUrl?: string | null;
    objectUrl?: string | null;
  } | null;
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
  original?: {
    bucket?: string | null;
    objectKey?: string | null;
    publicUrl?: string | null;
    mime?: string | null;
  } | null;
  set: (p: Partial<FlowState>) => void;
  setOriginal: (original: FlowState['original']) => void;
  reset: () => void;
};

const defaultState: Omit<FlowState, 'set' | 'setOriginal' | 'reset'> = {
  productType: 'mousepad',
  editorState: {},
  mockupBlob: undefined,
  mockupUrl: undefined,
  mockup: null,
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
  original: null,
};

const FlowContext = createContext<FlowState>({
  ...defaultState,
  set: () => {},
  setOriginal: () => {},
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
      if (p && typeof p === 'object') {
        if (Object.prototype.hasOwnProperty.call(p, 'mockupUrl')) {
          const nextMockupUrl = (p as { mockupUrl?: unknown }).mockupUrl;
          if (typeof s.mockupUrl === 'string'
            && s.mockupUrl
            && nextMockupUrl !== s.mockupUrl) {
            revokeIfObjectUrl(s.mockupUrl);
          }
        }
        if (Object.prototype.hasOwnProperty.call(p, 'mockup')) {
          const nextMockup = (p as { mockup?: FlowState['mockup'] }).mockup;
          const currentObjectUrl = typeof s.mockup?.objectUrl === 'string' ? s.mockup.objectUrl : null;
          const nextObjectUrl = typeof nextMockup?.objectUrl === 'string' ? nextMockup.objectUrl : null;
          if (currentObjectUrl && currentObjectUrl !== nextObjectUrl) {
            revokeIfObjectUrl(currentObjectUrl);
          }
        }
      }
      return { ...s, ...p };
    }),
    setOriginal: (original) => setState((s) => ({ ...s, original })),
    reset: () => {
      revokeIfObjectUrl(state.mockupUrl || undefined);
      revokeIfObjectUrl(state.mockup?.objectUrl || undefined);
      setState(defaultState);
    },
  };
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  return useContext(FlowContext);
}
