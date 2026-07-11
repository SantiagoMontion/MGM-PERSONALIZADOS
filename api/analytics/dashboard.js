/**
 * Ruta explícita para Vercel: el catch-all api/[...slug].js no siempre recibe
 * /api/analytics/dashboard (OPTIONS devolvía 404 sin CORS).
 */
import analyticsDashboard from '../../api-routes/analytics/dashboard.js';

export const config = {
  maxDuration: 15,
};

export default analyticsDashboard;
