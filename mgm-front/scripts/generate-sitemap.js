import { writeFileSync } from 'fs';

const baseUrl = 'https://example.com';
const routes = ['/', '/confirm'];

const urlset = routes
  .map(route => `  <url><loc>${baseUrl}${route}</loc></url>`) 
  .join('\n');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlset}\n</urlset>\n`;
writeFileSync('dist/sitemap.xml', sitemap);

const robots = `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
writeFileSync('dist/robots.txt', robots);
