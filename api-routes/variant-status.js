import variantStatus from '../lib/handlers/variantStatus.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'variant-status',
  context: 'variant-status',
  requiredEnv: resolveEnvRequirements('SHOPIFY_STOREFRONT'),
  handler: variantStatus,
});
