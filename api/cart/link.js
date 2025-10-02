import cartLink from '../../lib/handlers/cartLink.js';
import { createApiHandler } from '../_lib/createHandler.js';
import { resolveEnvRequirements } from '../_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'cart/link',
  context: 'cart-link',
  requiredEnv: resolveEnvRequirements('SUPABASE_SERVICE', 'SHOPIFY_STOREFRONT'),
  handler: cartLink,
});
