import { createContext, useContext, useState, ReactNode } from 'react';

export type FlowState = {
  productType: 'mousepad' | 'glasspad';
  editorState: any;
  mockupBlob?: Blob;
  mockupUrl?: string;
  mockupPublicUrl?: string;
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
  mockupPublicUrl: undefined,
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
  const value: FlowState = {
    ...state,
    set: (p) => setState((s) => ({ ...s, ...p })),
    reset: () => {
      if (state.mockupUrl) URL.revokeObjectURL(state.mockupUrl);
      setState(defaultState);
    },
  };
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  return useContext(FlowContext);
}
