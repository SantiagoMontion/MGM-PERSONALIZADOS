import { getClientIp } from './http.js';

const buckets = new Map();

export function enforceRateLimit(req, res, config = {}) {
  const limit = Number(config.limit) > 0 ? Number(config.limit) : 60;
  const windowMs = Number(config.windowMs) > 0 ? Number(config.windowMs) : 60_000;
  const scope = config.scope || `${req.method || 'ALL'}:${config.bucket || 'global'}`;
  const now = Date.now();

  const clientIp = config.ip || getClientIp(req);
  const key = `${clientIp}:${scope}`;

  let entry = buckets.get(key);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + windowMs };
    buckets.set(key, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);

  res.setHeader?.('X-RateLimit-Limit', String(limit));
  res.setHeader?.('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader?.('X-RateLimit-Reset', String(Math.ceil(entry.reset / 1000)));

  if (entry.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.reset - now) / 1000));
    res.setHeader?.('Retry-After', String(retryAfter));
    if (config.respond !== false) {
      if (typeof res.status === 'function') {
        res.status(429).json({ ok: false, error: 'rate_limited', retry_after: retryAfter });
      } else {
        res.statusCode = 429;
        res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
        res.end?.(JSON.stringify({ ok: false, error: 'rate_limited', retry_after: retryAfter }));
      }
    }
    return false;
  }

  return true;
}

export default { enforceRateLimit };
