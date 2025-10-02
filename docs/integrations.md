# Integrations

- En dev (modo recomendado): correr `npm run dev:vercel` en la raíz para levantar `vercel dev` en `http://localhost:3001` y, en `mgm-front`, ejecutar `npm run dev`. El front habla siempre con `/api`, así que no se necesitan URLs absolutas.
- En dev (modo alternativo): si corrés la API con `npm run dev:api`, asegurate de exportar `VITE_USE_PROXY=1` antes de `npm run dev` en `mgm-front` para que el proxy de Vite mantenga `/api` como origen.
- Webhooks Shopify: apuntar a `https://<tu-api>.vercel.app/api/shopify-webhook`.
