import { SITE } from '../seo/constants.js';

const CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';

export default function robots(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end('Método no permitido');
    return;
  }

  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /api',
    `Sitemap: ${SITE.baseUrl}/sitemap.xml`,
    `Host: ${SITE.baseUrl.replace(/^https?:\/\//, '')}`,
  ];

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.end(`${lines.join('\n')}\n`);
}
