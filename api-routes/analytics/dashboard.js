import { createApiHandler } from '../../api/_lib/createHandler.js';
import { analyticsDashboard } from '../../lib/handlers/analyticsDashboard.js';

export default createApiHandler({
  methods: 'GET',
  context: 'analytics-dashboard',
  handler: analyticsDashboard,
});
