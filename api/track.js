/**
 * Ruta explícita para Vercel: reemplaza api/track.ts (body no se parseaba en prod).
 */
import trackRoute from '../api-routes/track.js';

export const config = {
  maxDuration: 10,
};

export default trackRoute;
