import finalizeAssets from '../lib/handlers/finalizeAssets.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'finalize-assets',
  context: 'finalize-assets',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: finalizeAssets,
});
