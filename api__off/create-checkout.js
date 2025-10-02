import createCheckout from '../lib/handlers/createCheckout.js';
import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'create-checkout',
  context: 'create-checkout',
  requiredEnv: resolveEnvRequirements('SHOPIFY_STOREFRONT'),
  handler: createCheckout,
});
