import publishProduct from '../lib/handlers/publishProduct.js';
import { createApiHandler } from './_lib/createHandler.js';
import { resolveEnvRequirements } from './_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'publish-product',
  context: 'publish-product',
  requiredEnv: resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE'),
  handler: publishProduct,
});
