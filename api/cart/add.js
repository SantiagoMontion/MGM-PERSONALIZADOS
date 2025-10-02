import cartAdd from '../../lib/handlers/cartAdd.js';
import { createApiHandler } from '../_lib/createHandler.js';
import { resolveEnvRequirements } from '../_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'cart/add',
  context: 'cart-add',
  requiredEnv: resolveEnvRequirements('SHOPIFY_STOREFRONT'),
  handler: cartAdd,
});
