# Build

This project installs dependencies using the local npm registry.

- **Install Command:** `npm ci`
- **Build Command:** `npm run build`

The build uses the local `next` binary from `node_modules/.bin/next` and must not rely on `npx`.

If your network requires a proxy, configure the following environment variables:

- `HTTP_PROXY`
- `HTTPS_PROXY`
- `NPM_CONFIG_REGISTRY`

