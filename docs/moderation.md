# Moderación de imágenes

Este proyecto usa moderación **100% gratuita**: filtro rápido en el cliente con `nsfwjs` y verificación final en el servidor con `tesseract.js`.

## Cliente
- `nsfwjs` (TensorFlow.js 3.x) se carga de forma perezosa.
- Anime o dibujos siempre se permiten.
- Si parece sexual pero no es claro, se marca para revisión en el servidor (no se bloquea aquí).

## Servidor
- Endpoint: `POST /api/moderate-image`.
- No requiere claves externas ni proveedores pagos.
- Se realiza OCR local con `tesseract.js` y se busca texto de odio explícito.
- Sólo se bloquea si hay coincidencias claras con términos racistas o nazis.

Variables opcionales en `.env`:

```
NUDE_REAL_THRESHOLD=0.75
HATE_SPEECH_EXPLICIT_THRESHOLD=0.85
```

Anime/dibujo siempre permitido. El objetivo es bloquear únicamente discurso de odio textual detectado mediante OCR.
