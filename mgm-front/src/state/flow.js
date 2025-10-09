import React, { createContext, useContext, useState } from 'react';

const defaultState = {
  productType: 'mousepad',
  editorState: null,
  mockupBlob: null,
  mockupUrl: null,
  mockup: null,
  printFullResDataUrl: null,
  fileOriginalUrl: null,
  uploadObjectKey: null,
  originalObjectKey: null,
  uploadBucket: null,
  originalBucket: null,
  uploadDiagId: null,
  uploadSizeBytes: null,
  uploadContentType: null,
  originalMime: null,
  uploadSha256: null,
  jobId: null,
  designName: '',
  material: 'Classic',
  lowQualityAck: false,
  approxDpi: null,
  priceTransfer: 0,
  priceNormal: 0,
  priceCurrency: 'ARS',
  customerEmail: '',
  lastProduct: null,
  original: null,
};

const FlowContext = createContext({
  ...defaultState,
  set: () => {},
  setOriginal: () => {},
  reset: () => {},
});

export function FlowProvider({ children }) {
  const [state, setState] = useState(defaultState);
  const value = {
    ...state,
    set: (partial) => setState((s) => {
      if (partial && typeof partial === 'object') {
        if (Object.prototype.hasOwnProperty.call(partial, 'mockupUrl')) {
          const nextMockupUrl = partial.mockupUrl;
          if (s.mockupUrl && nextMockupUrl !== s.mockupUrl) {
            try {
              URL.revokeObjectURL(s.mockupUrl);
            } catch {}
          }
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'mockup')) {
          const nextMockup = partial.mockup;
          const currentObjectUrl = s.mockup && typeof s.mockup.objectUrl === 'string' ? s.mockup.objectUrl : null;
          const nextObjectUrl = nextMockup && typeof nextMockup.objectUrl === 'string' ? nextMockup.objectUrl : null;
          if (currentObjectUrl && currentObjectUrl !== nextObjectUrl) {
            try {
              URL.revokeObjectURL(currentObjectUrl);
            } catch {}
          }
        }
      }
      return { ...s, ...partial };
    }),
    setOriginal: (original) => setState((s) => ({ ...s, original })),
    reset: () => {
      try {
        if (state.mockupUrl) URL.revokeObjectURL(state.mockupUrl);
      } catch {
        // ignore
      }
      try {
        if (state.mockup && typeof state.mockup.objectUrl === 'string') {
          URL.revokeObjectURL(state.mockup.objectUrl);
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
