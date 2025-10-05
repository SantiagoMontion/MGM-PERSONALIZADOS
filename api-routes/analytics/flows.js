import { createApiHandler } from '../../api/_lib/createHandler.js';
import { proxyAnalyticsFlows } from '../../lib/handlers/adminAnalyticsProxy.js';

export default createApiHandler({
  methods: 'GET',
  context: 'analytics-flows',
  handler: proxyAnalyticsFlows,
});

