import { createApiHandler } from '../../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'prints/upload',
  context: 'prints-upload',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: async (req, res) => {
    const { uploadPrintHandler } = await import('../../lib/api/handlers/printsUpload.js');
    return uploadPrintHandler(req, res);
  },
});
