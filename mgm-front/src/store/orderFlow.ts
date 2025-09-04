import { createContext, useContext, useState, ReactNode } from 'react';

export type FlowState = {
  mode: 'Classic' | 'Pro' | 'Glasspad';
  width_cm: number;
  height_cm: number;
  bleed_mm: number;
  rotate_deg: number;
  preview_png_dataurl: string | null;
  master_png_dataurl: string | null;
  set: (p: Partial<FlowState>) => void;
  reset: () => void;
};

const defaultState: Omit<FlowState, 'set' | 'reset'> = {
  mode: 'Classic',
  width_cm: 0,
  height_cm: 0,
  bleed_mm: 0,
  rotate_deg: 0,
  preview_png_dataurl: null,
  master_png_dataurl: null,
};

const OrderFlowContext = createContext<FlowState>({
  ...defaultState,
  set: () => {},
  reset: () => {},
});

export function OrderFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(defaultState);
  const value: FlowState = {
    ...state,
    set: (p) => setState((s) => ({ ...s, ...p })),
    reset: () => setState(defaultState),
  };
  return <OrderFlowContext.Provider value={value}>{children}</OrderFlowContext.Provider>;
}

export function useOrderFlow() {
  return useContext(OrderFlowContext);
}
