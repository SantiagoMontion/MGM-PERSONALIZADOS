import submitJob from '../lib/handlers/submitJob.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'submit-job',
  context: 'submit-job',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE'),
  handler: submitJob,
});
