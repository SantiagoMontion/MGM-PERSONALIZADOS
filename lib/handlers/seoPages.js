import { ensureQuery } from '../_lib/http.js';
import {
  renderCheckoutPage,
  renderEditorPage,
  renderHomePage,
  renderProductPage,
} from '../seo/pages.js';

const CACHE_LONG = 'public, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_MEDIUM = 'public, s-maxage=1800, stale-while-revalidate=43200';
const CACHE_SHORT = 'public, s-maxage=600, stale-while-revalidate=3600';

function sendHtml(res, html, { status = 200, cache = CACHE_LONG } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.end(html);
}

export function seoHome(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end('Método no permitido');
    return;
  }
  const html = renderHomePage();
  sendHtml(res, html, { cache: CACHE_LONG });
}

export function seoEditor(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end('Método no permitido');
    return;
  }
  const html = renderEditorPage();
  sendHtml(res, html, { cache: CACHE_LONG });
}

export function seoCheckout(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end('Método no permitido');
    return;
  }
  const html = renderCheckoutPage();
  sendHtml(res, html, { cache: CACHE_MEDIUM });
}

export async function seoProduct(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    res.end('Método no permitido');
    return;
  }
  const query = ensureQuery(req);
  const id = [query?.id, query?.jobId, query?.job_id]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value);

  const { status, html } = await renderProductPage(id);
  const cache = status === 200 ? CACHE_MEDIUM : CACHE_SHORT;
  sendHtml(res, html, { status, cache });
}
