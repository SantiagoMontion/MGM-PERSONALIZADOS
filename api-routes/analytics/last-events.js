import { createApiHandler } from '../../api/_lib/createHandler.js';
import { proxyAnalyticsLastEvents } from '../../lib/handlers/adminAnalyticsProxy.js';

export default createApiHandler({
  methods: 'GET',
  context: 'analytics-last-events',
  handler: proxyAnalyticsLastEvents,
});

