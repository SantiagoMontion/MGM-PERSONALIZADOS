import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStorefrontCartServer,
  fallbackCartAdd,
  SimpleCookieJar,
} from '../lib/shopify/storefrontCartServer.js';

function createResponse(body, { status = 200, ok = true, headers = {} } = {}) {
  const text = JSON.stringify(body);
  const headerMap = new Map();
  for (const [key, value] of Object.entries(headers)) {
    headerMap.set(String(key).toLowerCase(), value);
  }
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headerMap.get(String(name || '').toLowerCase()) ?? null;
      },
    },
    async text() {
      return text;
    },
  };
}

test('createStorefrontCartServer requests checkoutUrl', async () => {
  const prevEnv = {
    SHOPIFY_STOREFRONT_TOKEN: process.env.SHOPIFY_STOREFRONT_TOKEN,
    SHOPIFY_STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
  };
  process.env.SHOPIFY_STOREFRONT_TOKEN = 'test-token';
  process.env.SHOPIFY_STOREFRONT_DOMAIN = 'https://store.example';
  process.env.SHOPIFY_STORE_DOMAIN = 'store.example';

  const calls = [];
  const fetchStub = mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return createResponse(
      {
        data: {
          cartCreate: {
            cart: {
              id: 'gid://shopify/Cart/test-cart',
              checkoutUrl: 'https://store.example/checkout/test-cart',
            },
            userErrors: [],
          },
        },
      },
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const result = await createStorefrontCartServer({
      variantGid: 'gid://shopify/ProductVariant/123456789',
      quantity: 1,
      buyerIp: '1.2.3.4',
    });

    assert.equal(result.ok, true);
    assert.equal(result.checkoutUrl, 'https://store.example/checkout/test-cart');
    assert.equal(result.cartUrl, 'https://store.example/cart/c/test-cart');
    assert.equal(calls.length, 1);
    const [{ init }] = calls;
    const payload = JSON.parse(init.body);
    assert.match(payload.query, /checkoutUrl/);
    assert.doesNotMatch(payload.query, /webUrl/);
    assert.equal(payload.variables.lines[0].merchandiseId, 'gid://shopify/ProductVariant/123456789');
  } finally {
    fetchStub.mock.restore();
    if (prevEnv.SHOPIFY_STOREFRONT_TOKEN === undefined) {
      delete process.env.SHOPIFY_STOREFRONT_TOKEN;
    } else {
      process.env.SHOPIFY_STOREFRONT_TOKEN = prevEnv.SHOPIFY_STOREFRONT_TOKEN;
    }
    if (prevEnv.SHOPIFY_STOREFRONT_DOMAIN === undefined) {
      delete process.env.SHOPIFY_STOREFRONT_DOMAIN;
    } else {
      process.env.SHOPIFY_STOREFRONT_DOMAIN = prevEnv.SHOPIFY_STOREFRONT_DOMAIN;
    }
    if (prevEnv.SHOPIFY_STORE_DOMAIN === undefined) {
      delete process.env.SHOPIFY_STORE_DOMAIN;
    } else {
      process.env.SHOPIFY_STORE_DOMAIN = prevEnv.SHOPIFY_STORE_DOMAIN;
    }
  }
});

test('fallbackCartAdd posts JSON items payload and returns cart url on success', async () => {
  const fetchCalls = [];
  const fetchStub = mock.method(global, 'fetch', async (url, init) => {
    fetchCalls.push({ url, init });
    return createResponse(
      {
        token: 'abcdef',
      },
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const jar = new SimpleCookieJar();
    const result = await fallbackCartAdd({ variantNumericId: '987654321', quantity: 2, jar });

    assert.equal(result.ok, true);
    assert.equal(result.cartUrl, 'https://www.mgmgamers.store/cart/c/abcdef');
    assert.equal(fetchCalls.length, 1);
    const { init } = fetchCalls[0];
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const parsed = JSON.parse(init.body);
    assert(Array.isArray(parsed.items));
    assert.equal(parsed.items[0].id, 987654321);
    assert.equal(parsed.items[0].quantity, 2);
    assert.deepEqual(parsed.items[0].properties, {});
  } finally {
    fetchStub.mock.restore();
  }
});

test('fallbackCartAdd surfaces detail when Shopify AJAX cart fails', async () => {
  const fetchStub = mock.method(global, 'fetch', async () =>
    createResponse(
      {
        status: 422,
        description: 'Variant unavailable',
      },
      { status: 422, ok: false, headers: { 'content-type': 'application/json' } },
    ),
  );

  try {
    const result = await fallbackCartAdd({ variantNumericId: '123456789', quantity: 1 });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ajax_cart_failed');
    assert.equal(result.status, 422);
    assert.match(result.detail, /Variant unavailable/);
  } finally {
    fetchStub.mock.restore();
  }
});
