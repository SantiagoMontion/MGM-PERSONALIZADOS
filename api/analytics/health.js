/**
 * Diagnóstico rápido: prueba lectura de track_events y devuelve el error real de Supabase.
 */
import getSupabaseAdmin from '../../lib/_lib/supabaseAdmin.js';
import { verifyAnalyticsAccess } from '../../lib/_lib/analyticsAuth.js';
import { withCors } from '../../lib/cors.js';
import { randomUUID } from 'node:crypto';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function handler(req, res) {
  const diagId = randomUUID();
  res.setHeader('X-Diag-Id', diagId);

  if (String(req.method || '').toUpperCase() !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  const auth = verifyAnalyticsAccess(req);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: 'unauthorized', diagId });
    return;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      diagId,
      step: 'init_supabase',
      error: error?.message || String(error),
    });
    return;
  }

  const { data, error, count } = await supabase
    .from('track_events')
    .select('id', { count: 'exact', head: true });

  if (error) {
    sendJson(res, 200, {
      ok: false,
      diagId,
      step: 'query_track_events',
      error_code: error.code || null,
      error_message: error.message || String(error),
      error_details: error.details || null,
      error_hint: error.hint || null,
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    diagId,
    track_events_count: typeof count === 'number' ? count : null,
    sample: Array.isArray(data) ? data : null,
  });
}

export default withCors(handler);
