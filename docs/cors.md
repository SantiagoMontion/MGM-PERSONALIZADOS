# CORS Layer

This project exposes API routes under `/api`. Reusable CORS helpers live in [`lib/cors.ts`](../lib/cors.ts).

## Allow list
Edit `ALLOWED_ORIGINS` inside `lib/cors.ts` to modify permitted origins.

## Adding CORS to new endpoints
For Pages API style handlers (`api/*.js`), wrap the handler:

```js
import { withCors } from '../lib/cors.ts';

async function handler(req, res) {
  // ...
}

export default withCors(handler);
```

`withCors` automatically responds to `OPTIONS` requests.

For App Router routes (`app/api/**`), use:

```ts
import { handlePreflight, applyCorsToResponse } from '@/lib/cors';

export async function OPTIONS(req: Request) {
  return handlePreflight(req);
}

export async function POST(req: Request) {
  const res = new Response('ok');
  return applyCorsToResponse(res, req.headers.get('origin'));
}
```

## Smoke test
Run `npm run cors:smoke` to verify preflight and regular requests.
