const RATE_LIMITS = new Map([
  ['POST moderate-image', { limit: 8, windowMs: 60_000 }],
  ['POST submit-job', { limit: 12, windowMs: 60_000 }],
  ['POST finalize-assets', { limit: 6, windowMs: 60_000 }],
  ['POST upload-url', { limit: 30, windowMs: 60_000 }],
  ['POST cart/link', { limit: 45, windowMs: 60_000 }],
  ['POST cart/start', { limit: 60, windowMs: 60_000 }],
  ['POST cart/add', { limit: 90, windowMs: 60_000 }],
  ['POST create-checkout', { limit: 45, windowMs: 60_000 }],
  ['POST private/checkout', { limit: 45, windowMs: 60_000 }],
  ['POST ensure-product-publication', { limit: 30, windowMs: 60_000 }],
  ['POST variant-status', { limit: 90, windowMs: 60_000 }],
  ['GET search-assets', { limit: 30, windowMs: 60_000 }],
  ['GET outputs/search', { limit: 30, windowMs: 60_000 }],
  ['POST prints/upload', { limit: 12, windowMs: 60_000 }],
  ['GET prints/search', { limit: 30, windowMs: 60_000 }],
  ['GET prints/preview', { limit: 60, windowMs: 60_000 }],
  ['POST shopify-webhook', { limit: 60, windowMs: 60_000 }],
]);

export function getRateLimitConfig(key) {
  return RATE_LIMITS.get(key) || null;
}

export default { getRateLimitConfig };
