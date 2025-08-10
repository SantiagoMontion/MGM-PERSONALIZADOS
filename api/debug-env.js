export default function handler(req, res) {
  res.status(200).json({
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || null,
    has_ADMIN_TOKEN: !!process.env.SHOPIFY_ADMIN_TOKEN,
    NODE: process.version
  });
}