# Moderación de imágenes

Este proyecto usa moderación **100% gratuita**: filtro rápido en el cliente con `nsfwjs` y verificación final en el servidor con heurísticas locales (`sharp`) y OCR con `tesseract.js`.

## Cliente
- `nsfwjs` (TensorFlow.js 3.x) se carga de forma perezosa y sólo bloquea desnudos reales.
- Se bloquea inmediatamente si el nombre del archivo o del modelo contiene términos nazis.
- Anime o dibujos siempre se permiten.

## Servidor
- Endpoint: `POST /api/moderate-image`.
- No requiere claves externas ni proveedores pagos.
- Se detecta discurso de odio nazi usando:
  - Búsqueda de términos prohibidos en nombre del archivo/modelo y en el texto detectado vía OCR (`tesseract.js`).
  - Búsqueda de símbolos de odio (esvásticas, banderas) con `pHash` y heurísticas de color.
- Los desnudos se filtran mediante detección de piel. Anime/dibujo se mantiene permitido.

Variables opcionales en `.env`:

```
NUDE_REAL_THRESHOLD=0.75
HATE_SPEECH_EXPLICIT_THRESHOLD=0.85
```

Anime/dibujo siempre permitido. El objetivo es bloquear únicamente discurso de odio textual detectado mediante OCR.
