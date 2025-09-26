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

The front uses a small API wrapper and a Vite proxy in dev to avoid CORS issues.

## CORS configuration

Set ALLOWED_ORIGINS to the list of explicit origins (no trailing slash).

`
ALLOWED_ORIGINS=http://localhost:5173,https://www.mgmgamers.store,https://mgm-api.vercel.app
`

## Upload de archivos

El endpoint `/api/upload-original` realiza la carga del diseño final usando el Service Role de Supabase. El backend genera el `object_key` (por ejemplo `original/<anio>/<mes>/<slug>-<size>-<material>-<hash>.png`) dentro del bucket `uploads`, registra logs con `{ bucketName, path, size, type }` antes de llamar a Storage y responde con la URL canónica (`file_original_url`) y un `signed_url` temporal (TTL 3600 s).

Para reproducir un upload exitoso en local:

1. Levantar API y front (`npm run dev:api` y `npm run dev` dentro de `mgm-front`).
2. Completar el flujo del editor y presionar **Continuar**. Esto envía el diseño como DataURL al backend, que lo sube al bucket `uploads` usando el Service Role.
3. Verificar en la consola del API el log `upload-original start` y confirmar que el objeto aparece en Supabase Storage bajo el bucket `uploads`.

El endpoint histórico `/api/upload-url` continúa disponible para compatibilidad con clientes que necesiten firmar subidas desde el front.

## Buckets

* uploads: privado
* outputs: pblico

## Moderation

Server-side only: 
sfwjs + @tensorflow/tfjs in the API and OCR with 	esseract.js. No paid services.
