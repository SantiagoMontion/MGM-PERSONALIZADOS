import publishProduct from '../lib/handlers/publishProduct.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'publish-product',
  context: 'publish-product',
  requiredEnv: resolveEnvRequirements('SHOPIFY_ADMIN', 'SUPABASE_SERVICE'),
  handler: publishProduct,
});

export const config = { runtime: 'nodejs' };
