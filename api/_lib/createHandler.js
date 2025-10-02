import { withCors } from '../../lib/cors.js';
import { ensureQuery } from '../../lib/_lib/http.js';
import { enforceRateLimit } from '../../lib/_lib/rateLimit.js';
import logger from '../../lib/_lib/logger.js';
import { getRateLimitConfig } from './rateLimits.js';
import { collectMissingEnv } from './envChecks.js';

function toMethodList(methods) {
  if (!methods) return ['GET'];
  if (Array.isArray(methods)) {
    return methods.map((method) => String(method || '').toUpperCase()).filter(Boolean);
  }
  const normalized = String(methods || '').toUpperCase();
  return normalized ? [normalized] : ['GET'];
}

function respondMissingEnv(res, { context, missing }) {
  const payload = {
    ok: false,
    error: 'missing_env',
    missing,
  };
  try {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  } catch (err) {
    logger.error?.('missing_env_response_failed', { context, err: err?.message || err });
  }
}

export function createApiHandler(options) {
  const {
    methods,
    handler,
    rateLimitKey,
    requiredEnv = [],
    context = 'api-handler',
  } = options || {};

  const allowedMethods = toMethodList(methods);

  return withCors(async (req, res) => {
    ensureQuery(req);

    if (!allowedMethods.includes(String(req.method || '').toUpperCase())) {
      res.setHeader?.('Allow', allowedMethods.join(', '));
      res.statusCode = 405;
      res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
      return;
    }

    const missing = collectMissingEnv(requiredEnv);
    if (missing.length) {
      try {
        logger.warn?.('api_missing_env', { context, missing });
      } catch {}
      respondMissingEnv(res, { context, missing });
      return;
    }

    if (rateLimitKey) {
      const scope = `${req.method} ${rateLimitKey}`;
      const config = getRateLimitConfig(scope);
      if (config) {
        const allowed = enforceRateLimit(req, res, { ...config, scope });
        if (!allowed) {
          return;
        }
      }
    }

    try {
      await handler(req, res);
    } catch (err) {
      try {
        logger.error?.('api_handler_error', { context, message: err?.message || err });
      } catch {}
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'handler_error' }));
      }
    }
  });
}

export default { createApiHandler };
