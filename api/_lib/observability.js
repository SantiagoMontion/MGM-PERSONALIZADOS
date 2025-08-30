import * as Sentry from '@sentry/node';

let initialized = false;

function init() {
  if (initialized || !process.env.SENTRY_DSN_API) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN_API,
    environment: process.env.SENTRY_ENV || process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
  initialized = true;
}

export function withObservability(handler) {
  init();
  return async function (req, res) {
    try {
      await handler(req, res);
    } catch (err) {
      const diagId = res.getHeader && res.getHeader('X-Diag-Id');
      Sentry.withScope((scope) => {
        if (diagId) scope.setTag('diag_id', diagId);
        scope.setTag('stage', 'handler');
        Sentry.captureException(err);
      });
      console.error('unhandled_error', { diagId, err });
      res.status(500).json({ ok: false, diag_id: diagId, stage: 'handler', message: 'internal_error' });
    }
  };
}
