import React from 'react';
import { ErrorBoundary } from '@sentry/react';
import { getDiagContext } from '../lib/diagContext';

function Fallback({ error, resetError }) {
  const ctx = getDiagContext();
  const diag = ctx.diag_id || error?.message?.match(/diag:([^\s]+)/)?.[1];
  const stage = ctx.stage || error?.message?.match(/stage:([^\s]+)/)?.[1];
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Ocurrió un error</h1>
      {diag && <p>diag_id: {diag}</p>}
      {stage && <p>stage: {stage}</p>}
      <button onClick={resetError}>Reintentar</button>
    </div>
  );
}

export default function AppErrorBoundary({ children }) {
  return (
    <ErrorBoundary
      fallback={Fallback}
      beforeCapture={(scope, error) => {
        const ctx = getDiagContext();
        if (ctx.diag_id) scope.setTag('diag_id', ctx.diag_id);
        if (ctx.stage) scope.setTag('stage', ctx.stage);
        if (ctx.job_id) scope.setTag('job_id', ctx.job_id);
        const msgDiag = error?.message?.match(/diag:([^\s]+)/)?.[1];
        if (msgDiag) scope.setTag('diag_id', msgDiag);
        const msgStage = error?.message?.match(/stage:([^\s]+)/)?.[1];
        if (msgStage) scope.setTag('stage', msgStage);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
