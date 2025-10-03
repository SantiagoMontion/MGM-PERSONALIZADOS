import moderateImage from '../lib/handlers/moderateImage.js';
import { createApiHandler } from '../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'POST',
  rateLimitKey: 'moderate-image',
  context: 'moderate-image',
  handler: moderateImage,
});
