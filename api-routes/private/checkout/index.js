import privateCheckout from '../../../lib/handlers/privateCheckout.js';
import { createApiHandler } from '../../../../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'private/checkout',
  context: 'private-checkout',
  handler: privateCheckout,
});
