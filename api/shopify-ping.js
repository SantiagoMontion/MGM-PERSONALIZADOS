// /api/shopify-ping.js
import { shopifyAdmin } from '../lib/shopify.js';

export default async function handler(req, res) {
  try {
    const data = await shopifyAdmin('/shop.json', { method: 'GET' });
    res.status(200).json({ ok: true, shop: data?.shop?.myshopify_domain });
  } catch (e) {
    res.status(500).json({
      ok: false,
      detail: String(e?.message || e),
      domain: process.env.SHOPIFY_STORE_DOMAIN || null
    });
  }
}
