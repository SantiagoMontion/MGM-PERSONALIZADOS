import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'GET',
  context: 'job-summary',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const module = await import('../lib/handlers/jobSummary.js');
    return module.default(req, res);
  },
});
