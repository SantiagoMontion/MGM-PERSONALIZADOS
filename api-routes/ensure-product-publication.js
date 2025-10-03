import ensureProductPublication from '../lib/handlers/ensureProductPublication.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'ensure-product-publication',
  context: 'ensure-product-publication',
  requiredEnv: resolveEnvRequirements('SHOPIFY_ADMIN'),
  handler: ensureProductPublication,
});
