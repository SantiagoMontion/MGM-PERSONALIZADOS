import { createApiHandler } from '../_lib/createHandler.js';

export default createApiHandler({
  methods: 'GET',
  context: 'seo-editor',
  handler: async (req, res) => {
    const module = await import('../../lib/handlers/seoPages.js');
    return module.seoEditor(req, res);
  },
});
