/**
 * Ruta explícita para Vercel: con api/cart/add.js el catch-all
 * api/[...slug].js NO recibe /api/cart/link (NOT_FOUND sin CORS).
 */
import cartLink from '../../api-routes/cart/link.js';

export const config = {
  memory: 256,
  maxDuration: 30,
};

export default cartLink;
