import shopifyWebhook from '../api-routes/shopify-webhook.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default shopifyWebhook;
