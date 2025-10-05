import { createApiHandler } from '../../api/_lib/createHandler.js';
import { proxyAnalyticsFunnel } from '../../lib/handlers/adminAnalyticsProxy.js';

export default createApiHandler({
  methods: 'GET',
  context: 'analytics-funnel',
  handler: proxyAnalyticsFunnel,
});

