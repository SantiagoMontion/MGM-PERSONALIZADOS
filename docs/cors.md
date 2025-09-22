# CORS Layer

This project exposes API routes under `/api`. Reusable CORS helpers live in [`lib/cors.js`](../lib/cors.js).

## Allow list
Edit the `ALLOWED` set inside `lib/cors.js` to modify permitted origins.

## Adding CORS to new endpoints
For Vercel serverless handlers (`api/*.js`), wrap the exported handler with `withCors`:

```js
import { withCors } from '../lib/cors.js';

async function handler(req, res) {
  // handler logic here
}

export default withCors(handler);
```

The helper automatically handles preflight requests and applies headers on all responses. You can opt-in to verbose logging by setting `DEBUG_CORS=1`.

## Smoke test
Run `npm run cors:smoke` to verify preflight and regular requests.
