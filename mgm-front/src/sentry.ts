import * as Sentry from '@sentry/react';
import { getDiagContext } from './lib/diagContext';

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN_FRONT;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENV || import.meta.env.MODE,
    integrations: [new Sentry.BrowserTracing()],
    tracesSampleRate: 1.0,
    beforeSend(event) {
      const ctx = getDiagContext();
      if (ctx.diag_id) event.tags = { ...event.tags, diag_id: ctx.diag_id };
      if (ctx.stage) event.tags = { ...event.tags, stage: ctx.stage };
      if (ctx.job_id) event.tags = { ...event.tags, job_id: ctx.job_id };
      return event;
    },
  });
}

export { Sentry };
