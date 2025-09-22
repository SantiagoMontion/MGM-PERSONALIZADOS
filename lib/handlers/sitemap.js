import { supa } from '../supa.js';
import { absoluteUrl } from '../seo/constants.js';

const CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

const STATIC_ROUTES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/mockup', changefreq: 'weekly', priority: '0.8' },
  { path: '/confirm', changefreq: 'weekly', priority: '0.6' },
  { path: '/mousepads-personalizados', changefreq: 'monthly', priority: '0.6' },
  { path: '/como-funciona', changefreq: 'monthly', priority: '0.5' },
  { path: '/preguntas-frecuentes', changefreq: 'monthly', priority: '0.5' },
  { path: '/contacto', changefreq: 'monthly', priority: '0.4' },
];

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

async function fetchProductRoutes(limit = 40) {
  try {
    const { data, error } = await supa
      .from('jobs')
      .select('job_id,created_at,is_public,shopify_product_url,preview_url')
      .or('is_public.eq.true,shopify_product_url.not.is.null')
      .not('preview_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      return [];
    }

    return data
      .filter((job) => job && typeof job.job_id === 'string' && job.job_id.trim())
      .map((job) => ({
        loc: absoluteUrl(`/result/${job.job_id}`),
        changefreq: 'weekly',
        priority: '0.5',
        lastmod: formatDate(job.created_at),
      }));
  } catch {
    return [];
  }
}

function renderUrlNode({ loc, changefreq, priority, lastmod }) {
  const parts = [`  <url>`, `    <loc>${loc}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  parts.push('  </url>');
  return parts.join('\n');
}

export default async function sitemap(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end('Método no permitido');
    return;
  }

  const productRoutes = await fetchProductRoutes();
  const staticRoutes = STATIC_ROUTES.map(({ path, ...rest }) => ({
    loc: absoluteUrl(path),
    ...rest,
  }));

  const allRoutes = [...staticRoutes, ...productRoutes];

  const xmlParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...allRoutes.map(renderUrlNode),
    '</urlset>',
  ];

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.end(xmlParts.join('\n'));
}
