import { createApiHandler } from '../../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'GET',
  context: 'seo-home',
  handler: async (req, res) => {
    const module = await import('../../lib/handlers/seoPages.js');
    return module.seoHome(req, res);
  },
});
