import logger from '../_lib/logger.js';

const DEFAULT_ANALYTICS_BASE = 'https://mgm-api.vercel.app/api/analytics';

function sanitizeBaseUrl(value) {
  if (!value) return '';
  return String(value).trim().replace(/\/+$/, '');
}

function ensureAnalyticsSuffix(base) {
  if (!base) return '';
  if (/\/analytics$/i.test(base)) {
    return base;
  }
  return `${base.replace(/\/+$/, '')}/analytics`;
}

function resolveAnalyticsBase() {
  const envBase = process.env?.ADMIN_ANALYTICS_API_BASE
    || process.env?.ANALYTICS_API_BASE
    || process.env?.MGM_API_BASE
    || process.env?.API_BASE_URL;
  const base = ensureAnalyticsSuffix(sanitizeBaseUrl(envBase))
    || DEFAULT_ANALYTICS_BASE;
  return sanitizeBaseUrl(base);
}

function resolveAdminToken(req) {
  const headerToken = req.headers?.['x-admin-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  if (Array.isArray(headerToken) && headerToken.length) {
    const [first] = headerToken;
    if (typeof first === 'string' && first.trim()) {
      return first.trim();
    }
  }

  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.*)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  const envToken = process.env?.ADMIN_ANALYTICS_TOKEN
    || process.env?.VITE_ADMIN_ANALYTICS_TOKEN
    || process.env?.ANALYTICS_ADMIN_TOKEN;

  return envToken ? String(envToken).trim() : '';
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function pickFirstQueryValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value[0] : undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

async function proxyAnalyticsRequest(req, res, options) {
  const { path, forwardQuery = [] } = options || {};

  const token = resolveAdminToken(req);
  if (!token) {
    sendJson(res, 401, { ok: false, error: 'missing_admin_token' });
    return;
  }

  const base = resolveAnalyticsBase();
  const targetPath = path ? String(path).replace(/^\/+/, '') : '';
  const targetUrl = new URL(`${base}/${targetPath}`);

  for (const queryKey of forwardQuery) {
    const value = pickFirstQueryValue(req.query?.[queryKey]);
    if (value !== undefined && value !== null && value !== '') {
      targetUrl.searchParams.set(queryKey, value);
    }
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Admin-Token': token,
      },
    });
  } catch (err) {
    logger.error?.('analytics_proxy_fetch_failed', {
      path: targetPath,
      error: err?.message || err,
    });
    sendJson(res, 502, { ok: false, error: 'analytics_upstream_unreachable' });
    return;
  }

  let text = '';
  try {
    text = await upstreamResponse.text();
  } catch (err) {
    logger.warn?.('analytics_proxy_read_failed', {
      path: targetPath,
      error: err?.message || err,
    });
  }

  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      logger.warn?.('analytics_proxy_invalid_json', {
        path: targetPath,
        error: err?.message || err,
        snippet: text.slice(0, 120),
      });
    }
  }

  const status = upstreamResponse.status || 502;
  if (!upstreamResponse.ok || !json) {
    const payload = json || {
      ok: false,
      error: 'analytics_upstream_error',
      status,
    };
    sendJson(res, status === 401 ? 401 : 502, payload);
    return;
  }

  sendJson(res, 200, json);
}

export async function proxyAnalyticsFlows(req, res) {
  return proxyAnalyticsRequest(req, res, { path: 'flows', forwardQuery: ['from', 'to'] });
}

export async function proxyAnalyticsFunnel(req, res) {
  return proxyAnalyticsRequest(req, res, { path: 'funnel', forwardQuery: ['from', 'to'] });
}

export async function proxyAnalyticsLastEvents(req, res) {
  return proxyAnalyticsRequest(req, res, { path: 'last-events', forwardQuery: ['limit'] });
}

export default {
  proxyAnalyticsFlows,
  proxyAnalyticsFunnel,
  proxyAnalyticsLastEvents,
};

