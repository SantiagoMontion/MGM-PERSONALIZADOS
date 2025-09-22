# API Overview

This project deploys a Vercel serverless API under the `/api` prefix. All handlers share CORS middleware via `lib/cors.js` and return JSON responses.

## Rate limiting

Requests are throttled per client IP. Current limits:

| Method | Path | Window | Limit |
| --- | --- | --- | --- |
| POST | `/api/moderate-image` | 60 s | 8 |
| POST | `/api/submit-job` | 60 s | 12 |
| POST | `/api/finalize-assets` | 60 s | 6 |
| POST | `/api/upload-url` | 60 s | 30 |
| POST | `/api/create-cart-link` | 60 s | 45 |
| POST | `/api/create-checkout` | 60 s | 45 |
| POST | `/api/shopify-webhook` | 60 s | 60 |
| GET | `/api/search-assets` | 60 s | 30 |

If the limit is exceeded the API returns HTTP `429` with `{ ok: false, error: 'rate_limited', retry_after }`.

## Endpoint reference

### `GET /api/healthcheck`

Returns `{ ok: true, ts }`. Useful for load balancers.

### `POST /api/create-cart-link`

Generates a Shopify cart URL. Request body must be JSON matching:

```json
{
  "variantId": "gid://..." | "123456789",
  "quantity": 1
}
```

- `variantId` or `variantGid` must contain a numeric variant ID.
- `quantity` is coerced to an integer between `1` and `99`.
- Responses:
  - `200` with `{ ok: true, cart_url, checkout_url_now, ... }`.
  - `400` when validation fails (`missing_variant`, `invalid_body`, `invalid_json`).
  - `413` for bodies over ~512 KiB (`payload_too_large`).

### `POST /api/create-checkout`

Builds a Shopify checkout URL with the same body schema as `create-cart-link`. Returns `{ ok: true, url }`. Validation and error codes mirror the cart-link endpoint.

### `POST /api/upload-url`

Creates a public Supabase storage URL for an upload. Requires:

- `design_name`, `ext`, `mime`, `size_bytes`, `material`, `w_cm`, `h_cm`, `sha256`.
- Rejects files above `MAX_UPLOAD_MB` (defaults to 40 MB) or sizes exceeding material limits.

### `POST /api/submit-job`

Persists job metadata. The handler enforces required fields (job id, sizing, upload URLs) and returns `400` for invalid payloads or Supabase insert errors.

### `GET /api/job-status`

Requires `job_id` query parameter (8–64 characters, `[A-Za-z0-9_-]`). Returns `{ ok: true, job }` with current status or:

- `400` for invalid IDs (`invalid_job_id`).
- `404` when the job does not exist.
- `500` if Supabase credentials are missing or the query fails.

### `GET /api/job-summary`

Similar to `job-status` but optimized for UI summaries. Accepts `id` query parameter with the same validation rules. Responds with `404`/`409` when Supabase returns none or multiple rows. All responses include the `diag_id` header for traceability.

### `GET /api/search-assets`

Requires `term` query parameter (1–120 characters). Sanitizes characters such as `%`, `'`, `"`, and backticks before building the Supabase filter. Returns the 20 most recent matches or:

- `400` with `invalid_term` when validation fails.
- `500` when Supabase queries fail.

### `POST /api/finalize-assets`

Processes design assets: downloads the source, renders preview/print/PDF files, uploads them to Supabase storage and updates the job. Returns `400` for missing job IDs or downloads, `500` for rendering/upload errors.

### `POST /api/moderate-image`

Performs image moderation (nudity detection, hash comparisons, OCR for hate speech). Returns moderation verdicts that the frontend uses before allowing checkout.

### `POST /api/shopify-webhook`

Validates incoming Shopify webhooks:

- Requires `SHOPIFY_WEBHOOK_SECRET` environment variable.
- Reads the raw body and verifies the `x-shopify-hmac-sha256` signature using a timing-safe comparison.
- Rejects invalid or missing signatures with HTTP `401`.
- Returns `{ ok: true, diag_id, received, topic }` on success.

### `POST /api/publish-product`

Creates Shopify products using admin APIs. Relies on the request body produced by the frontend workflow and returns job/product URLs or error diagnostics from Shopify.

### `POST /api/worker-process`

Placeholder endpoint that currently returns HTTP `501`.

### `GET /api/render-dryrun`

Not implemented; returns HTTP `501`.
