import { randomUUID } from 'node:crypto';

import { withCors } from '../../lib/cors.js';
import { ensureQuery } from '../../lib/_lib/http.js';
import { searchPrintsHandler } from '../../lib/api/handlers/printsSearch.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default withCors(async function printsSearch(req, res) {
  if (req.method !== 'GET') {
    const requestId = randomUUID();
    console.error('prints_search_error', {
      diagId: requestId,
      type: 'method_not_allowed',
      method: req.method,
    });
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, {
      ok: false,
      reason: 'method_not_allowed',
      code: 'method_not_allowed',
      message: 'Método no permitido. Usá GET en /api/prints/search.',
      requestId,
    });
  }

  ensureQuery(req);
  const { status, body } = await searchPrintsHandler({
    query: req.query,
    headers: req.headers,
  });
  return sendJson(res, status, body);
});
