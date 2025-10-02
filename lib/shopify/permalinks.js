import { idVariantGidToNumeric } from '../utils/shopifyIds.js';
import { buildOnlineStoreCartPermalink, buildOnlineStorePermalink } from '../utils/permalink.js';
import logger from '../_lib/logger.js';

export { buildOnlineStoreCartPermalink, buildOnlineStorePermalink };

export function buildOnlineStorePermalinkFromGid({ variantGid, quantity = 1, discountCode } = {}) {
  let numericId;
  try {
    numericId = idVariantGidToNumeric(variantGid);
  } catch (err) {
    try {
      logger.warn('build_online_store_permalink_invalid_gid', {
        message: err?.message || String(err),
        variantGid: variantGid ?? null,
      });
    } catch {}
    return '';
  }
  return buildOnlineStorePermalink(numericId, quantity, discountCode);
}

export default {
  idVariantGidToNumeric,
  buildOnlineStorePermalink,
  buildOnlineStorePermalinkFromGid,
};
