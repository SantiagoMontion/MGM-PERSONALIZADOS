import { randomUUID } from 'node:crypto';
import logger from '../../lib/_lib/logger.js';

import { withCors } from '../../lib/cors.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default withCors(function printsHealth(req, res) {
  if (req.method !== 'GET') {
    const requestId = randomUUID();
    logger.error('prints_health_error', {
      diagId: requestId,
      type: 'method_not_allowed',
      method: req.method,
    });
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, {
      ok: false,
      reason: 'method_not_allowed',
      code: 'method_not_allowed',
      message: 'Método no permitido. Usá GET en /api/prints/health.',
      requestId,
    });
  }

  return sendJson(res, 200, { ok: true });
});
