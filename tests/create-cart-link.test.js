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

test('create-cart-link uses cart/add and returns mgm cart when base is mgmgamers', async () => {
  const prev = {
    STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    PUBLIC_BASE: process.env.SHOPIFY_PUBLIC_BASE,
    HOME_URL: process.env.SHOPIFY_HOME_URL,
    CART_RETURN: process.env.SHOPIFY_CART_RETURN_TO,
  };
  try {
    process.env.SHOPIFY_STORE_DOMAIN = 'mgmgamers-store.myshopify.com';
    delete process.env.SHOPIFY_PUBLIC_BASE;
    delete process.env.SHOPIFY_HOME_URL;
    delete process.env.SHOPIFY_CART_RETURN_TO;

    const req = {
      method: 'POST',
      body: { variantId: '123456789', quantity: 2 },
    };
    const res = createMockRes();

    await createCartLink(req, res);

    assert.equal(res.statusCode, 200);
    assert(res.jsonPayload);

    const { cart_url: cartUrl } = res.jsonPayload;
    assert(cartUrl);
    const parsed = new URL(cartUrl);
    assert.equal(parsed.pathname, '/cart/add');
    assert.equal(parsed.searchParams.get('id'), '123456789');
    assert.equal(parsed.searchParams.get('quantity'), '2');
    assert.equal(parsed.searchParams.get('return_to'), 'https://www.mgmgamers.store/cart');
  } finally {
    process.env.SHOPIFY_STORE_DOMAIN = prev.STORE_DOMAIN;
    if (prev.PUBLIC_BASE === undefined) delete process.env.SHOPIFY_PUBLIC_BASE; else process.env.SHOPIFY_PUBLIC_BASE = prev.PUBLIC_BASE;
    if (prev.HOME_URL === undefined) delete process.env.SHOPIFY_HOME_URL; else process.env.SHOPIFY_HOME_URL = prev.HOME_URL;
    if (prev.CART_RETURN === undefined) delete process.env.SHOPIFY_CART_RETURN_TO; else process.env.SHOPIFY_CART_RETURN_TO = prev.CART_RETURN;
  }
});
