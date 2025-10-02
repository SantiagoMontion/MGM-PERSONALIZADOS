import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'GET',
  rateLimitKey: 'search-assets',
  context: 'search-assets',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const { searchAssets } = await import('../lib/api/handlers/assets.js');
    const { status, body } = await searchAssets({ query: req.query });
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  },
});
