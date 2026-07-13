/**
 * Ruta explícita para Vercel: con api/cart/add.js el catch-all
 * api/[...slug].js NO recibe /api/cart/start (NOT_FOUND sin CORS).
 */
import cartStart from '../../api-routes/cart/start.js';

export const config = {
  memory: 256,
  maxDuration: 15,
};

export default cartStart;
