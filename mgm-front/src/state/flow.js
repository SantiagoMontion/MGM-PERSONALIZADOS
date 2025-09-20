import React, { createContext, useContext, useState } from 'react';

const defaultState = {
  productType: 'mousepad',
  editorState: null,
  mockupBlob: null,
  mockupUrl: null,
  printFullResDataUrl: null,
  lowQualityAck: false,
  approxDpi: null,
  lastProduct: null,
};

const FlowContext = createContext({
  ...defaultState,
  set: () => {},
  reset: () => {},
});

export function FlowProvider({ children }) {
  const [state, setState] = useState(defaultState);
  const value = {
    ...state,
    set: (partial) => setState((s) => ({ ...s, ...partial })),
    reset: () => {
      try {
        if (state.mockupUrl) URL.revokeObjectURL(state.mockupUrl);
      } catch (_) {
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
