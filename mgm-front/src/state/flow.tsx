import { createContext, useContext, useState, ReactNode } from 'react';

export type FlowState = {
  productType: 'mousepad' | 'glasspad';
  editorState: any;
  mockupBlob?: Blob;
  mockupUrl?: string;
  printFullResDataUrl?: string;
  lowQualityAck?: boolean;
  approxDpi?: number | null;
  lastProduct?: { productId?: string; variantId?: string; cartUrl?: string; checkoutUrl?: string };
  set: (p: Partial<FlowState>) => void;
  reset: () => void;
};

const defaultState: Omit<FlowState, 'set' | 'reset'> = {
  productType: 'mousepad',
  editorState: {},
  mockupBlob: undefined,
  mockupUrl: undefined,
  printFullResDataUrl: undefined,
  lowQualityAck: false,
  approxDpi: null,
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
