import { randomUUID } from 'node:crypto';
import logger from '../../lib/_lib/logger.js';
import { createApiHandler } from '../_lib/createHandler.js';
import { resolveEnvRequirements } from '../_lib/envChecks.js';
import { searchPrintsHandler } from '../../lib/api/handlers/printsSearch.js';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default createApiHandler({
  methods: ['GET', 'POST'],
  rateLimitKey: 'prints/search',
  context: 'prints-search',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const requestId = randomUUID();
    if (req.method !== 'GET') {
      logger.error('prints_search_error', {
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

    const { status, body } = await searchPrintsHandler({
      query: req.query,
      headers: req.headers,
    });
    return sendJson(res, status, body);
  },
});
