/**
 * Vercel entry for POST /api/moderate-image.
 * Runs the real evaluateImage pipeline (sharp + pHash + OCR).
 * Previously this file was a label-only stub that always allowed Home uploads.
 */
import moderateImageRoute from '../api-routes/moderate-image.js';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '8mb',
  },
  maxDuration: 60,
};

export default moderateImageRoute;
