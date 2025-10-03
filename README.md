# MGM API

## Dev setup (two terminals)

Terminal 1 (API):

`
npm run dev:api
`

Terminal 2 (Front):

`
cd mgm-front
npm run dev
`

With this setup:
- Front: http://localhost:5173
- API:   http://localhost:3001

La app de React resuelve todas las llamadas como rutas relativas (`/api/...`), por lo que no hace falta un proxy local.

## Build para deploy

- Comando: `npm run build`
- Salida estática: `mgm-front/dist`

El build compila el cliente de Vite y deja los assets listos para que Vercel los sirva junto a las funciones de `/api`.

## CORS configuration

`lib/cors.js` keeps a base allowlist for localhost, the production storefront, and the Vercel API URL. For deployments:

- Preview builds rely on `VERCEL_URL`, so `https://<project>.vercel.app` is added automatically.
- Set `API_PUBLIC_ORIGIN` to your public domain (for example `https://www.mgmgamers.store`) and include any additional custom domains that serve the SPA.
- Local development continues to use `http://localhost:5173` or `http://127.0.0.1:5173`.

## Upload de archivos

El endpoint `/api/upload-original` realiza la carga del diseño final usando el Service Role de Supabase. El backend genera el `object_key` (por ejemplo `original/<anio>/<mes>/<slug>-<size>-<material>-<hash>.png`) dentro del bucket `uploads`, registra logs con `{ bucketName, path, size, type }` antes de llamar a Storage y responde con la URL canónica (`file_original_url`) y un `signed_url` temporal (TTL 3600 s).

Para reproducir un upload exitoso en local:

1. Levantar API y front (`npm run dev:api` y `npm run dev` dentro de `mgm-front`).
2. Completar el flujo del editor y presionar **Continuar**. Esto envía el diseño como DataURL al backend, que lo sube al bucket `uploads` usando el Service Role.
3. Verificar en la consola del API el log `upload-original start` y confirmar que el objeto aparece en Supabase Storage bajo el bucket `uploads`.

El endpoint histórico `/api/upload-url` continúa disponible para compatibilidad con clientes que necesiten firmar subidas desde el front.

## QA manual

Smoke tests sugeridos después de cada deploy (Preview/Prod):

- Abrir `/` y verificar que la SPA carga sin errores.
- `GET /api/health` (si está habilitado) → 200.
- `GET /api/prints/search?query=test&limit=5&offset=0` → 200 y `returned <= 5`.
- Ejecutar “Agregar al carrito” y “Comprar” público: debe devolver permalink y abrir checkout.
- Ejecutar “Comprar privado”: debe marcar `custom.private=true`, devolver permalink y abrir checkout privado.
- Revisar logs: solo `warn`/`error`, sin dumps grandes.

## Buckets

* uploads: privado
* outputs: pblico

## Moderation

Server-side only: 
sfwjs + @tensorflow/tfjs in the API and OCR with 	esseract.js. No paid services.

