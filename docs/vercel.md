Este proyecto (APIs) se despliega desde la **raíz**.

En Vercel configura:
- Framework: "Other"
- Build Command: (vacío) o `npm run vercel-build`
- Output Directory recomendado: `.`
- Node.js: 20.x
- Mientras el Output Directory en el Dashboard siga en `public`, la carpeta mínima `public/` evita el error.

El front (`mgm-front`) se despliega en otro proyecto con Root Directory=`mgm-front`.

Requeridos (ENV) para Shopify (API root):

```
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_xxx
SHOPIFY_API_VERSION=2024-07
# (opcionales si usas Storefront API en otro lugar)
STOREFRONT_TOKEN=
STOREFRONT_DOMAIN=
# (opcional) Canal de ventas usado en los links de carrito/checkout
# SHOPIFY_SALES_CHANNEL=online_store
# SHOPIFY_CART_CHANNEL=
# SHOPIFY_CHECKOUT_CHANNEL=
```
