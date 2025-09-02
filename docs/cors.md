# CORS Layer

This project exposes API routes under `/api`. Reusable CORS helpers live in [`lib/cors.ts`](../lib/cors.ts).

## Allow list
Edit `ALLOWED_ORIGINS` inside `lib/cors.ts` to modify permitted origins.

## Adding CORS to new endpoints
For Pages API style handlers (`api/*.js`), compute CORS headers per request:

```js
import { buildCorsHeaders } from '../lib/cors.ts';

export default async function handler(req, res) {
  const origin = req.headers.origin || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  // ...
}
```

For App Router routes (`app/api/**`), use:

```ts
import { buildCorsHeaders, preflight, withCorsJson } from '@/lib/cors';

export async function OPTIONS(req: Request) {
  return preflight(req.headers.get('origin'));
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const cors = buildCorsHeaders(origin);
  if (!cors) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const res = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  Object.entries(cors).forEach(([k, v]) => res.headers.set(k, String(v)));
  return res;
}
```

## Smoke test
Run `npm run cors:smoke` to verify preflight and regular requests.
