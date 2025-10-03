import { createApiHandler } from '../../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'GET',
  rateLimitKey: 'prints/preview',
  context: 'prints-preview',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const module = await import('../../lib/api/handlers/printsPreview.js');
    return module.default(req, res);
  },
});
