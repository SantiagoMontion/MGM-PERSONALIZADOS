import renderDryrun from '../lib/handlers/renderDryrun.js';
import { createApiHandler } from './_lib/createHandler.js';

export default createApiHandler({
  methods: 'GET',
  context: 'render-dryrun',
  handler: renderDryrun,
});
