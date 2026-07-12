import { createApiHandler } from '../../api/_lib/createHandler.js';
import { analyticsSyncPurchasesCron } from '../../lib/handlers/analyticsSyncPurchasesCron.js';

export default createApiHandler({
  methods: ['GET', 'POST'],
  context: 'analytics-sync-purchases-cron',
  handler: analyticsSyncPurchasesCron,
});
