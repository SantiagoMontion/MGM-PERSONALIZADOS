# Moderación de imágenes

Este proyecto incluye un filtro rápido en el cliente (`nsfwjs`) y una verificación final en el servidor.

## Cliente
- Se usa `nsfwjs` para descartar rápidamente contenido NSFW de personas reales.
- Anime/dibujos se permiten.
- Si el chequeo rápido detecta posible desnudez real, se envía `strict: true` al servidor.

## Servidor
- Endpoint: `POST /api/moderate-image`.
- Proveedor seleccionable vía `MOD_PROVIDER` (`HIVE` o `SIGHTENGINE`).
- Variables de entorno necesarias:
  - `HIVE_API_KEY`
  - `SIGHTENGINE_USER` y `SIGHTENGINE_SECRET`
- Umbrales configurables:
  - `NUDE_REAL_THRESHOLD` (default `0.75`)
  - `HATE_SYMBOL_THRESHOLD` (default `0.80`)
  - `HATE_SPEECH_EXPLICIT_THRESHOLD` (default `0.85`)

El endpoint bloquea únicamente desnudez de personas reales, actividad sexual explícita, símbolos extremistas y discurso de odio explícito.

Para cambiar de proveedor, ajusta `MOD_PROVIDER` en tu entorno y configura las claves correspondientes.
