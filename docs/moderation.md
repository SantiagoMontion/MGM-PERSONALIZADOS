# Moderación de imágenes

Este proyecto usa moderación **100% gratuita**: filtro rápido en el cliente con `nsfwjs` y verificación final en el servidor con heurísticas locales (`sharp`) y OCR con `tesseract.js`.

El servidor clasifica cada imagen en **BLOCK**, **REVIEW** o **ALLOW** y devuelve `label`, `reasons` y `confidence` (0–1).

Prioridad de las reglas:

1. **BLOCK** – Desnudez/sexual de personas reales (detección de piel, heurísticas de blob y meta datos).
2. **BLOCK** – Extremismo/Nazismo (pHash, colorimetría y OCR/texto).
3. **ALLOW** – Contenido animado/dibujado con alta confianza de no ser personas reales.
4. **REVIEW** – Casos ambiguos: rostros ocultos, baja resolución o dudas entre real/dibujado.

## Cliente
- `nsfwjs` (TensorFlow.js 3.x) se carga de forma perezosa y sólo bloquea desnudos reales.
- Se bloquea inmediatamente si el nombre del archivo o del modelo contiene términos nazis.
- Anime o dibujos se permiten cuando el analizador tiene confianza ≥ 0.7 de que no son personas reales.

## Servidor
- Endpoint: `POST /api/moderate-image`.
- No requiere claves externas ni proveedores pagos.
- Se detecta discurso de odio nazi usando:
  - Búsqueda de términos prohibidos en nombre del archivo/modelo y en el texto detectado vía OCR (`tesseract.js`).
  - Búsqueda de símbolos de odio (esvásticas, banderas) con `pHash` y heurísticas de color.
- Los desnudos se filtran mediante detección de piel. También se estima si la imagen es animada vs. real para aplicar las reglas anteriores.

Variables opcionales en `.env`:

```
NUDE_REAL_THRESHOLD=0.75
HATE_SPEECH_EXPLICIT_THRESHOLD=0.85
```

El objetivo es bloquear únicamente desnudos reales y extremismo nazi; todo lo demás pasa o queda pendiente de revisión según la confianza calculada.
