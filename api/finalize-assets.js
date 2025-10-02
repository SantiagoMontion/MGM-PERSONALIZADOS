import finalizeAssets from '../lib/handlers/finalizeAssets.js';
import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'finalize-assets',
  context: 'finalize-assets',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: finalizeAssets,
});
