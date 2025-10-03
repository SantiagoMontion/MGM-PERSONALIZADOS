import uploadOriginal from '../lib/handlers/uploadOriginal.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'upload-original',
  context: 'upload-original',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: uploadOriginal,
});
