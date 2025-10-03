import { createApiHandler } from '../../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'GET',
  context: 'seo-product',
  handler: async (req, res) => {
    const module = await import('../../lib/handlers/seoPages.js');
    return module.seoProduct(req, res);
  },
});
