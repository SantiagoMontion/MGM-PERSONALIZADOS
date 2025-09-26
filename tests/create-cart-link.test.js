import test from 'node:test';
import assert from 'node:assert/strict';
import createCartLink from '../lib/handlers/createCartLink.js';

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

test('create-cart-link uses Storefront API and returns mgm cart link', async () => {
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
      if (callCount === 1) {
        assert.match(payload.query, /VariantAvailability/);
        assert.equal(payload.variables.id, 'gid://shopify/ProductVariant/123456789');
        return createFetchResponse({
          data: {
            node: {
              id: 'gid://shopify/ProductVariant/123456789',
              availableForSale: true,
            },
          },
        });
      }
      assert.equal(callCount, 2);
      assert.ok(url.includes('/graphql.json'));
      assert.equal(payload.variables.input.lines[0].merchandiseId, 'gid://shopify/ProductVariant/123456789');
      assert.equal(payload.variables.input.lines[0].quantity, 2);
      return createFetchResponse(
        {
          data: {
            cartCreate: {
              cart: {
                id: 'gid://shopify/Cart/abcdef',
                checkoutUrl: 'https://www.mgmgamers.store/checkouts/abcdef',
              },
              userErrors: [],
            },
          },
        },
        { headers: { 'x-request-id': 'req-1' } },
      );
    };

    const req = {
      method: 'POST',
      body: { variantId: '123456789', quantity: 2 },
      headers: { host: 'example.com' },
    };
    const res = createMockRes();

    await createCartLink(req, res);

    assert.equal(callCount, 2);
    assert.equal(res.statusCode, 200);
    assert(res.jsonPayload);
    const { webUrl, cart_method: cartMethod, checkout_url_now: checkoutUrl, cart_plain: cartPlain } = res.jsonPayload;
    assert.equal(cartMethod, 'storefront');
    assert.equal(webUrl, 'https://www.mgmgamers.store/cart/c/abcdef');
    assert.equal(checkoutUrl, 'https://www.mgmgamers.store/checkouts/abcdef');
    assert.equal(cartPlain, 'https://www.mgmgamers.store/cart');
  } finally {
    global.fetch = prevFetch;
    process.env.SHOPIFY_STORE_DOMAIN = prev.STORE_DOMAIN;
    if (prev.STOREFRONT_DOMAIN === undefined) delete process.env.SHOPIFY_STOREFRONT_DOMAIN; else process.env.SHOPIFY_STOREFRONT_DOMAIN = prev.STOREFRONT_DOMAIN;
    if (prev.STOREFRONT_TOKEN === undefined) delete process.env.SHOPIFY_STOREFRONT_TOKEN; else process.env.SHOPIFY_STOREFRONT_TOKEN = prev.STOREFRONT_TOKEN;
  }
});

test('create-cart-link falls back to legacy cart when Storefront env missing', async () => {
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

    await createCartLink(req, res);

    assert.equal(res.statusCode, 200);
    assert(res.jsonPayload);
    const { ok, webUrl, cart_method: cartMethod, reason } = res.jsonPayload;
    assert.equal(ok, true);
    assert.equal(cartMethod, 'permalink');
    assert.equal(webUrl, 'https://www.mgmgamers.store/cart/123456789:2?return_to=/cart');
    assert.ok(reason);
  } finally {
    global.fetch = prevFetch;
    process.env.SHOPIFY_STORE_DOMAIN = prev.STORE_DOMAIN;
    if (prev.STOREFRONT_DOMAIN === undefined) delete process.env.SHOPIFY_STOREFRONT_DOMAIN; else process.env.SHOPIFY_STOREFRONT_DOMAIN = prev.STOREFRONT_DOMAIN;
    if (prev.STOREFRONT_TOKEN === undefined) delete process.env.SHOPIFY_STOREFRONT_TOKEN; else process.env.SHOPIFY_STOREFRONT_TOKEN = prev.STOREFRONT_TOKEN;
    if (prev.PUBLIC_BASE === undefined) delete process.env.SHOPIFY_PUBLIC_BASE; else process.env.SHOPIFY_PUBLIC_BASE = prev.PUBLIC_BASE;
  }
});
