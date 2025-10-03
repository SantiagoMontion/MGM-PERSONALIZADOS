import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'GET',
  rateLimitKey: 'job-status',
  context: 'job-status',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const module = await import('../lib/handlers/jobStatus.js');
    return module.default(req, res);
  },
});
