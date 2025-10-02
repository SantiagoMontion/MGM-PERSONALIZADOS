import ensureProductPublication from '../lib/handlers/ensureProductPublication.js';
import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'ensure-product-publication',
  context: 'ensure-product-publication',
  requiredEnv: resolveEnvRequirements('SHOPIFY_ADMIN'),
  handler: ensureProductPublication,
});
