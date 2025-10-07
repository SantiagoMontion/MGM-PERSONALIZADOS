import type { VercelRequest, VercelResponse } from '@vercel/node';
import printsUpload from '../../api-routes/prints/upload.js';

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '32mb',
  },
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return printsUpload(req, res);
}
