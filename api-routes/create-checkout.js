import createCheckout from '../lib/handlers/createCheckout.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'create-checkout',
  context: 'create-checkout',
  requiredEnv: resolveEnvRequirements('SHOPIFY_STOREFRONT'),
  handler: createCheckout,
});

export const config = { runtime: 'nodejs' };
