import cartStart from '../../lib/handlers/cartStart.js';
import { createApiHandler } from '../../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'cart/start',
  context: 'cart-start',
  handler: cartStart,
});
