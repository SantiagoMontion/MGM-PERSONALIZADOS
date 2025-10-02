import test from 'node:test';
import assert from 'node:assert/strict';
import { idVariantGidToNumeric } from '../lib/utils/shopifyIds.js';

const SAMPLE_GID = 'gid://shopify/ProductVariant/53473441907060';
const SAMPLE_ID = '53473441907060';
const SAMPLE_GID_WITH_QUERY = `${SAMPLE_GID}?foo=bar`;
const SAMPLE_BASE64 = 'Z2lkOi8vc2hvcGlmeS9Qcm9kdWN0VmFyaWFudC81MzQ3MzQ0MTkwNzA2MA==';

test('idVariantGidToNumeric extracts digits from Shopify GID', () => {
  assert.equal(idVariantGidToNumeric(SAMPLE_GID), SAMPLE_ID);
});

test('idVariantGidToNumeric returns numeric string unchanged', () => {
  assert.equal(idVariantGidToNumeric(SAMPLE_ID), SAMPLE_ID);
});

test('idVariantGidToNumeric tolerates query parameters', () => {
  assert.equal(idVariantGidToNumeric(SAMPLE_GID_WITH_QUERY), SAMPLE_ID);
});

test('idVariantGidToNumeric decodes base64 GID payloads', () => {
  assert.equal(idVariantGidToNumeric(SAMPLE_BASE64), SAMPLE_ID);
});

test('idVariantGidToNumeric throws on invalid values', () => {
  assert.throws(() => idVariantGidToNumeric('not-a-valid-id'), /Invalid variant ID format/);
});
