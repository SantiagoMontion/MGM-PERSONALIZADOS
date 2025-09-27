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
| POST | `/api/cart/link` | 60 s | 45 |
| POST | `/api/create-checkout` | 60 s | 45 |
| POST | `/api/private/checkout` | 60 s | 45 |
| POST | `/api/ensure-product-publication` | 60 s | 30 |
| POST | `/api/variant-status` | 60 s | 90 |
| POST | `/api/shopify-webhook` | 60 s | 60 |
| GET | `/api/search-assets` | 60 s | 30 |

If the limit is exceeded the API returns HTTP `429` with `{ ok: false, error: 'rate_limited', retry_after }`.

## Endpoint reference

### `GET /api/healthcheck`

Returns `{ ok: true, ts }`. Useful for load balancers.

### `POST /api/cart/link`

Creates a Shopify cart that includes a single product variant and returns `{ url, webUrl, checkoutUrl?, strategy, requestId? }` where `url === webUrl` on the Storefront path. When Shopify cannot create the cart the handler falls back to the public permalink (`https://www.mgmgamers.store/cart/<variantId>:<quantity>`).

- Request body must include `variantId` (numeric or GraphQL). `quantity` defaults to `1` and is clamped between `1` and `99`.
- The handler short-polls variant availability through Storefront (`WaitVariant`) for up to ~5 s before attempting `cartCreate`. Failures (user errors, Storefront outages, 5xx responses) return a permalink so the browser can open `/cart` directly. All error payloads include `ok: false` and, when available, Shopify `requestId`/`userErrors`.
- Invalid payloads return `400 { reason: 'bad_request' }`. Oversized bodies return `413`.

### `POST /api/private/checkout`

Produces a checkout link for the private flow based on `PRIVATE_CHECKOUT_MODE`.

- `storefront` (default): creates a Storefront cart and responds with `{ checkoutUrl, cartUrl?, strategy: 'storefront' }`, preserving Shopify's coupon UI. When the storefront path fails (variant unavailable, Storefront credentials missing, etc.) the handler transparently falls back to the draft-order flow.
- `draft_order`: creates an Admin draft order and returns `{ checkoutUrl, strategy: 'draft_order' }` pointing to the invoice URL. Draft orders now accept optional `discount` payloads (percentage or fixed-amount) which are applied with `draftOrderUpdate`, keeping Shopify's discount input available on the invoice checkout. Responses include `requestIds` for traceability when Shopify returns a `requestId` header.

The request accepts `variantId`, optional `quantity`, `email`, `note`, `noteAttributes` and `discount`. Missing or invalid payloads yield `400 { reason: 'bad_request' }`. Shopify failures return `502` with a `reason` field and, when available, `userErrors` plus `requestId(s)`.

### `POST /api/create-checkout`

Legacy endpoint for público (checkout directo). Accepts the same body schema as before (variant ID, optional email/discount) and returns `{ ok: true, url }`.

### `POST /api/ensure-product-publication`

Ensures a Shopify product is published to the Online Store channel. The request body must include `productId` (numeric or GraphQL ID). The handler dynamically discovers the Online Store publication (ignoring an invalid `SHOPIFY_PUBLICATION_ID` if necessary), republishes the product with retry/backoff on transient errors and returns metadata such as `publicationIdSource`, `recoveries` and `publishAttempts`. Verification failures are returned in the `verification` field without aborting the flow. Responds with `400` for invalid payloads, `404` if the product cannot be found and `502` when Shopify rejects all publication attempts.

### `POST /api/variant-status`

Checks whether a product variant is visible and available for sale through the Storefront API. Accepts `variantId` (numeric or GraphQL ID) and `productId`. Returns `{ ok: true, ready, published, available, variantPresent }`, where `ready` becomes `true` once the variant appears in the Storefront product response with `availableForSale === true`. Intended for short polling loops (exponential backoff up to ~45 s) after creating a product. Responds with `404` when the product is not yet visible and `502` when the Storefront API cannot fulfill the status query.

### `POST /api/upload-url`

Creates a Supabase Storage upload target for the original artwork. Requires:

- `design_name`, `ext`, `mime`, `size_bytes`, `material`, `w_cm`, `h_cm`, `sha256`.
- Rejects files above `MAX_UPLOAD_MB` (defaults to 40 MB) or sizes exceeding material limits.

Returns:

- `object_key`: path within the `uploads` bucket.
- `file_original_url` / `canonical_url`: deterministic public URL to persist on the job record.
- `upload_url`: direct REST endpoint (`/storage/v1/object/uploads/...`) kept for backwards compatibility.
- `upload`: `{ signed_url, token, expires_in }` for `PUT` uploads using Supabase's signed URLs (recommended).

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
