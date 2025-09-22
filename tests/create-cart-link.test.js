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

test('create-cart-link uses Storefront API and returns mgm cart link', async () => {
  const prev = {
    STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    STOREFRONT_TOKEN: process.env.SHOPIFY_STOREFRONT_TOKEN,
    PUBLIC_BASE: process.env.SHOPIFY_PUBLIC_BASE,
    HOME_URL: process.env.SHOPIFY_HOME_URL,
    CART_RETURN: process.env.SHOPIFY_CART_RETURN_TO,
  };
  const prevFetch = global.fetch;
  try {
    process.env.SHOPIFY_STORE_DOMAIN = 'mgmgamers-store.myshopify.com';
    process.env.SHOPIFY_STOREFRONT_DOMAIN = 'https://www.mgmgamers.store';
    process.env.SHOPIFY_STOREFRONT_TOKEN = 'shpca_test_token';
    delete process.env.SHOPIFY_PUBLIC_BASE;
    delete process.env.SHOPIFY_HOME_URL;
    delete process.env.SHOPIFY_CART_RETURN_TO;

    let receivedRequest;
    global.fetch = async (url, init) => {
      receivedRequest = { url, init };
      const payload = JSON.parse(init.body);
      assert.equal(payload.variables.input.lines[0].merchandiseId, 'gid://shopify/ProductVariant/123456789');
      assert.equal(payload.variables.input.lines[0].quantity, 2);
      const responseBody = {
        data: {
          cartCreate: {
            cart: {
              id: 'gid://shopify/Cart/abcdef',
              checkoutUrl: 'https://www.mgmgamers.store/checkouts/abcdef',
            },
            userErrors: [],
          },
        },
      };
      return {
        ok: true,
        status: 200,
        json: async () => responseBody,
        text: async () => JSON.stringify(responseBody),
      };
    };

    const req = {
      method: 'POST',
      body: { variantId: '123456789', quantity: 2 },
      headers: { host: 'example.com' },
    };
    const res = createMockRes();

    await createCartLink(req, res);

    assert(receivedRequest);
    assert.ok(receivedRequest.url.includes('/graphql.json'));
    assert.equal(res.statusCode, 200);
    assert(res.jsonPayload);

    const { cart_url: cartUrl, checkout_url_now: checkoutUrl, cart_plain: cartPlain, cart_method: cartMethod } = res.jsonPayload;
    assert.equal(cartMethod, 'storefront');
    assert.equal(cartUrl, 'https://www.mgmgamers.store/cart/c/abcdef');
    assert.equal(checkoutUrl, 'https://www.mgmgamers.store/checkouts/abcdef');
    assert.equal(cartPlain, 'https://www.mgmgamers.store/cart');
  } finally {
    global.fetch = prevFetch;
    process.env.SHOPIFY_STORE_DOMAIN = prev.STORE_DOMAIN;
    if (prev.STOREFRONT_DOMAIN === undefined) delete process.env.SHOPIFY_STOREFRONT_DOMAIN; else process.env.SHOPIFY_STOREFRONT_DOMAIN = prev.STOREFRONT_DOMAIN;
    if (prev.STOREFRONT_TOKEN === undefined) delete process.env.SHOPIFY_STOREFRONT_TOKEN; else process.env.SHOPIFY_STOREFRONT_TOKEN = prev.STOREFRONT_TOKEN;
    if (prev.PUBLIC_BASE === undefined) delete process.env.SHOPIFY_PUBLIC_BASE; else process.env.SHOPIFY_PUBLIC_BASE = prev.PUBLIC_BASE;
    if (prev.HOME_URL === undefined) delete process.env.SHOPIFY_HOME_URL; else process.env.SHOPIFY_HOME_URL = prev.HOME_URL;
    if (prev.CART_RETURN === undefined) delete process.env.SHOPIFY_CART_RETURN_TO; else process.env.SHOPIFY_CART_RETURN_TO = prev.CART_RETURN;
  }
});
