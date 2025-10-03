import robotsHandler from '../lib/handlers/robots.js';
import { createApiHandler } from './_lib/createHandler.js';

export default createApiHandler({
  methods: 'GET',
  context: 'robots.txt',
  handler: robotsHandler,
});
