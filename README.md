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

El endpoint /api/upload-url genera una URL firmada de Supabase Storage para subir el archivo original.

## Buckets

* uploads: privado
* outputs: público

## Moderation

Server-side only: 
sfwjs + @tensorflow/tfjs in the API and OCR with 	esseract.js. No paid services.
