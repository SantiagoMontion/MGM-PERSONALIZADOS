import uploadUrl from '../lib/handlers/uploadUrl.js';
import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'upload-url',
  context: 'upload-url',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: uploadUrl,
});
