import { randomUUID } from 'node:crypto';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';
import logger from '../../_lib/logger.js';
import { verifyPrintsGate } from '../_lib/printsGate.js';
import { resolveDownloadUrl, resolveFileName } from './printsSearch.js';

function sendJson(res, status, payload) {
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(payload);
}

function pickGateToken(req) {
  const header = req.headers?.['x-prints-gate'] || req.headers?.['X-Prints-Gate'];
  if (header) {
    const raw = Array.isArray(header) ? header[0] : header;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  const queryGate = req.query?.gate;
  return typeof queryGate === 'string' ? queryGate.trim() : '';
}

export default async function printsDownloadHandler(req, res) {
  const diagId = randomUUID();
  const gateToken = pickGateToken(req);
  const gate = verifyPrintsGate({
    headers: { 'x-prints-gate': gateToken },
    diagId,
  });
  if (!gate.ok) {
    sendJson(res, 401, { ok: false, reason: 'unauthorized', diagId });
    return;
  }

  const id = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
  if (!id) {
    sendJson(res, 400, { ok: false, reason: 'missing_id', message: 'Falta el parámetro "id".', diagId });
    return;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    const message = err?.message || 'supabase_init_failed';
    sendJson(res, 502, { ok: false, reason: 'supabase_init_failed', message, diagId });
    return;
  }

  const { data: row, error } = await supabase
    .from('prints')
    .select('id, file_name, file_path, bucket, width_cm, height_cm')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.warn('prints_download_db_error', { diagId, id, message: error.message });
    sendJson(res, 502, { ok: false, reason: 'db_error', diagId });
    return;
  }
  if (!row) {
    sendJson(res, 404, { ok: false, reason: 'not_found', diagId });
    return;
  }

  const fileName = row.file_name || resolveFileName(row.file_path);
  const downloadUrl = await resolveDownloadUrl(supabase, row, fileName);
  if (!downloadUrl) {
    sendJson(res, 404, {
      ok: false,
      reason: 'download_unavailable',
      message: 'No se pudo generar el enlace de descarga para este PDF.',
      diagId,
    });
    return;
  }

  res.redirect(302, downloadUrl);
}
