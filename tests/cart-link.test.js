import test from 'node:test';
import assert from 'node:assert/strict';
import cartLink from '../lib/handlers/cartLink.js';

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    jsonPayload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(payload) {
      this.jsonPayload = payload;
      return payload;
    },
  };
}

function createFetchResponse(body, options = {}) {
  const text = JSON.stringify(body);
  const headerMap = new Map();
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headerMap.set(key.toLowerCase(), value);
    }
  }
  return {
    ok: options.ok !== false,
    status: options.status ?? 200,
    text: async () => text,
    headers: {
      get(name) {
        return headerMap.get(String(name || '').toLowerCase()) ?? null;
      },
    },
  };
}

test('cart/link returns permalink for available variant', async () => {
  const prev = {
    STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    STOREFRONT_TOKEN: process.env.SHOPIFY_STOREFRONT_TOKEN,
  };
  const prevFetch = global.fetch;
  try {
    process.env.SHOPIFY_STORE_DOMAIN = 'mgmgamers-store.myshopify.com';
    process.env.SHOPIFY_STOREFRONT_DOMAIN = 'https://www.mgmgamers.store';
    process.env.SHOPIFY_STOREFRONT_TOKEN = 'shpca_test_token';

    let callCount = 0;
    global.fetch = async (url, init) => {
      callCount += 1;
      const payload = JSON.parse(init.body);
      assert.equal(callCount, 1);
      assert.match(payload.query, /WaitVariant/);
      assert.equal(payload.variables.id, 'gid://shopify/ProductVariant/123456789');
      return createFetchResponse({
        data: {
          node: {
            id: 'gid://shopify/ProductVariant/123456789',
            availableForSale: true,
          },
        },
      });
    };

    const req = {
      method: 'POST',
      body: { variantId: '123456789', quantity: 2 },
      headers: { host: 'example.com' },
    };
    const res = createMockRes();

    await cartLink(req, res);

    assert.equal(callCount, 1);
    assert.equal(res.statusCode, 200);
    assert(res.jsonPayload);
    const { url, webUrl, checkoutUrl, cartPlain, strategy } = res.jsonPayload;
    assert.equal(strategy, 'permalink');
    assert.equal(url, 'https://www.mgmgamers.store/cart/123456789:2');
    assert.equal(webUrl, 'https://www.mgmgamers.store/cart/123456789:2');
    assert.equal(checkoutUrl, 'https://www.mgmgamers.store/cart/123456789:2');
    assert.equal(cartPlain, 'https://www.mgmgamers.store/cart');
  } finally {
    global.fetch = prevFetch;
    process.env.SHOPIFY_STORE_DOMAIN = prev.STORE_DOMAIN;
    if (prev.STOREFRONT_DOMAIN === undefined) delete process.env.SHOPIFY_STOREFRONT_DOMAIN; else process.env.SHOPIFY_STOREFRONT_DOMAIN = prev.STOREFRONT_DOMAIN;
    if (prev.STOREFRONT_TOKEN === undefined) delete process.env.SHOPIFY_STOREFRONT_TOKEN; else process.env.SHOPIFY_STOREFRONT_TOKEN = prev.STOREFRONT_TOKEN;
  }
});

test('cart/link falls back to permalink when Storefront env missing', async () => {
  const prev = {
    STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    STOREFRONT_TOKEN: process.env.SHOPIFY_STOREFRONT_TOKEN,
    PUBLIC_BASE: process.env.SHOPIFY_PUBLIC_BASE,
  };
  const prevFetch = global.fetch;
  try {
    process.env.SHOPIFY_STORE_DOMAIN = 'kw0f4u-ji.myshopify.com';
    delete process.env.SHOPIFY_STOREFRONT_DOMAIN;
    delete process.env.SHOPIFY_STOREFRONT_TOKEN;
    process.env.SHOPIFY_PUBLIC_BASE = 'https://kw0f4u-ji.myshopify.com';

    global.fetch = () => {
      throw new Error('fetch should not be called when storefront token is missing');
    };

    const req = {
      method: 'POST',
      body: { variantId: '123456789', quantity: 2 },
      headers: { host: 'example.com' },
    };
    const res = createMockRes();

    await cartLink(req, res);

    assert.equal(res.statusCode, 200);
    assert(res.jsonPayload);
    const { url, webUrl, strategy } = res.jsonPayload;
    assert.equal(strategy, 'permalink');
    assert.equal(url, 'https://www.mgmgamers.store/cart/123456789:2');
    assert.equal(webUrl, 'https://www.mgmgamers.store/cart/123456789:2');
  } finally {
    global.fetch = prevFetch;
    process.env.SHOPIFY_STORE_DOMAIN = prev.STORE_DOMAIN;
    if (prev.STOREFRONT_DOMAIN === undefined) delete process.env.SHOPIFY_STOREFRONT_DOMAIN; else process.env.SHOPIFY_STOREFRONT_DOMAIN = prev.STOREFRONT_DOMAIN;
    if (prev.STOREFRONT_TOKEN === undefined) delete process.env.SHOPIFY_STOREFRONT_TOKEN; else process.env.SHOPIFY_STOREFRONT_TOKEN = prev.STOREFRONT_TOKEN;
    if (prev.PUBLIC_BASE === undefined) delete process.env.SHOPIFY_PUBLIC_BASE; else process.env.SHOPIFY_PUBLIC_BASE = prev.PUBLIC_BASE;
  }
});
