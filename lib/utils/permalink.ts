export type BuildOnlineStoreCartPermalink = (
  variantIdNumeric: string,
  qty: number,
  discountCode?: string,
) => string;

export { buildOnlineStoreCartPermalink, buildOnlineStorePermalink } from './permalink.js';
