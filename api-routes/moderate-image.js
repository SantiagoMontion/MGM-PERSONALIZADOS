import moderateImage from '../lib/handlers/moderateImage.js';
import { createApiHandler } from '../api/_lib/createHandler.js';

const postHandler = createApiHandler({
  methods: 'POST',
  rateLimitKey: 'moderate-image',
  context: 'moderate-image',
  handler: moderateImage,
});

export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return moderateImage(req, res);
  }
  return postHandler(req, res);
}
