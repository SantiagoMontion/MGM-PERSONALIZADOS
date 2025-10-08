import type { VercelRequest, VercelResponse } from '@vercel/node';
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { createDiagId, logApiError } from '../_lib/diag.js';

const ALLOW_HEADERS = 'Content-Type, X-Admin-Token';
const EXPOSE_HEADERS = 'X-Diag-Id';

function resolveAdminToken(): string | undefined {
  return process.env.ADMIN_DIAG_TOKEN || process.env.ADMIN_ANALYTICS_TOKEN;
}

function sendJson(
  res: VercelResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.status(status).json(body);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = createDiagId();
  const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  const origin = typeof originHeader === 'string' && originHeader ? originHeader : '*';
  const baseHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Expose-Headers': EXPOSE_HEADERS,
    Vary: 'Origin',
    'X-Diag-Id': diagId,
  };

  if (req.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(baseHeaders)) {
      res.setHeader(key, value);
    }
    res.status(204).end();
    return;
  }

  if ((req.method || '').toUpperCase() !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed', diagId }, baseHeaders);
    return;
  }

  const expectedToken = resolveAdminToken();
  if (!expectedToken) {
    sendJson(res, 200, { ok: false, error: 'missing_env', diagId }, baseHeaders);
    return;
  }

  const rawToken = req.headers['x-admin-token'];
  const providedToken = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (!providedToken || providedToken !== expectedToken) {
    sendJson(res, 401, { ok: false, error: 'unauthorized', diagId }, baseHeaders);
    return;
  }

  const queryRid = req.query?.rid;
  const rid = Array.isArray(queryRid) ? queryRid[0] : queryRid;
  const normalizedRid = typeof rid === 'string' ? rid.trim() : '';
  if (!normalizedRid) {
    sendJson(res, 400, { ok: false, error: 'missing_rid', diagId }, baseHeaders);
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('publish_refs')
      .select('rid,product_id,original_object_key,original_url,mockup_url,design_slug,size_mm,material,margin_mm,original_mime')
      .eq('rid', normalizedRid)
      .maybeSingle();

    if (error) {
      logApiError('diag-job', { diagId, step: 'lookup_failed', error });
      sendJson(res, 502, { ok: false, error: 'lookup_failed', diagId }, baseHeaders);
      return;
    }

    const reference = data
      ? {
          rid: data.rid ?? null,
          productId: data.product_id ?? null,
          originalObjectKey: data.original_object_key ?? null,
          originalUrl: data.original_url ?? null,
          mockupUrl: data.mockup_url ?? null,
          designSlug: data.design_slug ?? null,
          sizeMm: data.size_mm ?? null,
          material: data.material ?? null,
          marginMm: data.margin_mm ?? null,
          originalMime: data.original_mime ?? null,
        }
      : null;

    sendJson(res, 200, { ok: true, diagId, rid: normalizedRid, reference }, baseHeaders);
  } catch (error) {
    logApiError('diag-job', { diagId, step: 'unhandled', error });
    sendJson(res, 500, { ok: false, error: 'internal_error', diagId }, baseHeaders);
  }
}
