/**
 * Ruta explícita para Vercel: el catch-all api/[...slug].js a veces no recibe
 * /api/prints/search (OPTIONS devolvía 404 sin CORS). Esta función asegura
 * el mismo handler que api-routes/prints/search.js para GET + preflight.
 */
import printsSearch from '../../api-routes/prints/search.js';

export const config = {
  maxDuration: 60,
};

export default printsSearch;
