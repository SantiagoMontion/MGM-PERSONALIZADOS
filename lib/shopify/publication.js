import { shopifyAdminGraphQL } from '../shopify.js';

let onlineStorePublicationIdPromise;

function normalizeId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw;
}

function extractNumericId(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/(\d+)(?:[^\d]*)$/);
  return match ? match[1] : '';
}

export function ensureProductGid(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  const numeric = extractNumericId(raw);
  if (!numeric) return '';
  return `gid://shopify/Product/${numeric}`;
}

export function ensureVariantGid(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (raw.startsWith('gid://')) return raw;
  const numeric = extractNumericId(raw);
  if (!numeric) return '';
  return `gid://shopify/ProductVariant/${numeric}`;
}

function getPublicationIdFromEnv() {
  const raw = normalizeId(process.env.SHOPIFY_PUBLICATION_ID);
  if (!raw) return '';
  return raw;
}

async function fetchOnlineStorePublicationId() {
  const query = `query OnlineStorePublication {
    publications(first: 15) {
      nodes {
        id
        name
        channelDefinition { handle }
      }
    }
  }`;
  const resp = await shopifyAdminGraphQL(query);
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(`publication_fetch_failed_${resp.status}`);
    err.body = json;
    throw err;
  }
  const nodes = json?.data?.publications?.nodes || [];
  const match = nodes.find((node) => node?.channelDefinition?.handle === 'online_store')
    || nodes.find((node) => typeof node?.name === 'string' && /online/i.test(node.name));
  if (!match?.id) {
    throw new Error('online_store_publication_missing');
  }
  return String(match.id);
}

export async function getOnlineStorePublicationId() {
  const fromEnv = getPublicationIdFromEnv();
  if (fromEnv) return fromEnv;
  if (!onlineStorePublicationIdPromise) {
    onlineStorePublicationIdPromise = fetchOnlineStorePublicationId().catch((err) => {
      onlineStorePublicationIdPromise = undefined;
      throw err;
    });
  }
  return onlineStorePublicationIdPromise;
}

export function resetCachedPublicationId() {
  onlineStorePublicationIdPromise = undefined;
}

export async function publishToOnlineStore(productGid, publicationIdOverride) {
  const publishableId = ensureProductGid(productGid);
  if (!publishableId) return;
  try {
    const publicationId = normalizeId(publicationIdOverride) || await getOnlineStorePublicationId();
    if (!publicationId) return;
    const mutation = `mutation PublishProduct($id: ID!, $publicationId: ID!) {
      publishablePublish(id: $id, input: { publicationId: $publicationId }) {
        userErrors { code message field }
      }
    }`;
    const resp = await shopifyAdminGraphQL(mutation, { id: publishableId, publicationId });
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const err = new Error(`publish_product_publication_http_${resp.status}`);
      err.body = json;
      throw err;
    }
    const userErrors = Array.isArray(json?.data?.publishablePublish?.userErrors)
      ? json.data.publishablePublish.userErrors.filter((err) => err && err.message)
      : [];
    if (userErrors.length) {
      console.error('publish_product_publish_errors', userErrors);
    }
  } catch (err) {
    console.error('publish_product_publish_failed', err);
  }
}

export default {
  ensureProductGid,
  ensureVariantGid,
  getOnlineStorePublicationId,
  publishToOnlineStore,
  resetCachedPublicationId,
};
