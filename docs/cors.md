# CORS Layer

This project exposes API routes under `/api`. Reusable CORS helpers live in [`lib/cors.js`](../lib/cors.js).

## Allow list
Edit the `ALLOWED` set inside `lib/cors.js` to modify permitted origins.

### Preview configuration

The API preview environment must explicitly list the front-end preview origin in
`ALLOWED_ORIGINS`. For the current preview this value is
`https://mgm-front-git-work-gpt-5-codex.vercel.app` (note the missing trailing
slash). Sanitisation inside `lib/cors.js` already strips extra slashes, but
keeping the stored value normalized simplifies diffs in the Vercel dashboard.

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
