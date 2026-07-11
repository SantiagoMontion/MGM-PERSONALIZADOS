import { createApiHandler } from '../api/_lib/createHandler.js';
import { trackEvents } from '../lib/handlers/trackEvents.js';

export default createApiHandler({
  methods: 'POST',
  context: 'track-events',
  handler: trackEvents,
});
