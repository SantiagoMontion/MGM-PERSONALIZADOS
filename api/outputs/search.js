import { createApiHandler } from '../_lib/createHandler.js';
import { resolveEnvRequirements } from '../_lib/envChecks.js';

export default createApiHandler({
  methods: 'GET',
  rateLimitKey: 'outputs/search',
  context: 'outputs-search',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const { searchOutputFiles } = await import('../../lib/api/handlers/outputsSearch.js');
    const { status, body } = await searchOutputFiles({ query: req.query });
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  },
});
