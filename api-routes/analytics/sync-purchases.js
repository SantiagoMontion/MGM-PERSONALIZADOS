import { createApiHandler } from '../../api/_lib/createHandler.js';
import { analyticsSyncPurchases } from '../../lib/handlers/analyticsSyncPurchases.js';

export default createApiHandler({
  methods: 'POST',
  context: 'analytics-sync-purchases',
  handler: analyticsSyncPurchases,
});
