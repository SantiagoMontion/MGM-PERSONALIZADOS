import submitJob from '../lib/handlers/submitJob.js';
import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'submit-job',
  context: 'submit-job',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: submitJob,
});
