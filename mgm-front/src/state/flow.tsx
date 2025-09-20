import { createContext, useContext, useState, ReactNode } from 'react';

export type FlowState = {
  productType: 'mousepad' | 'glasspad';
  editorState: any;
  mockupBlob?: Blob;
  mockupUrl?: string;
  printFullResDataUrl?: string;
  designName?: string;
  material?: string;
  lowQualityAck?: boolean;
  approxDpi?: number | null;
  priceTransfer?: number;
  priceNormal?: number;
  priceCurrency?: string;
  lastProduct?: {
    productId?: string;
    variantId?: string;
    cartUrl?: string;
    checkoutUrl?: string;
    productUrl?: string;
    productHandle?: string;
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
  designName: '',
  material: 'Classic',
  lowQualityAck: false,
  approxDpi: null,
  priceTransfer: 0,
  priceNormal: 0,
  priceCurrency: 'ARS',
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
