import shopifyWebhook from '../lib/handlers/shopifyWebhook.js';
import { createApiHandler } from '../api/_lib/createHandler.js';
import { resolveEnvRequirements } from '../api/_lib/envChecks.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'shopify-webhook',
  context: 'shopify-webhook',
  requiredEnv: resolveEnvRequirements('SHOPIFY_ADMIN', 'SHOPIFY_WEBHOOK_SECRET'),
  handler: shopifyWebhook,
});
