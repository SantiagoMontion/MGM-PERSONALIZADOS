import { createApiHandler } from '../../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'GET',
  rateLimitKey: 'prints/download',
  context: 'prints-download',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const module = await import('../../lib/api/handlers/printsDownload.js');
    return module.default(req, res);
  },
});
