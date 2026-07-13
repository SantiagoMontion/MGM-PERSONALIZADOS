/**
 * Ruta explícita para Vercel: el catch-all api/[...slug].js no siempre recibe
 * /api/analytics/dashboard (OPTIONS devolvía 404 sin CORS).
 */
import analyticsDashboard from '../../api-routes/analytics/dashboard.js';

export const config = {
  // Antes 15s: el sync Shopify + query 30 días explotaba en 504 sin CORS.
  maxDuration: 60,
};

export default analyticsDashboard;
