import sitemapHandler from '../lib/handlers/sitemap.js';
import { createApiHandler } from '../api/_lib/createHandler.js';

export default createApiHandler({
  methods: 'GET',
  context: 'sitemap.xml',
  handler: sitemapHandler,
});
