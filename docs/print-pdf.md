# Generación de PDF de impresión sin pérdidas

El módulo `lib/_lib/imageToPdf.js` encapsula la lógica para convertir el raster subido por el usuario en un PDF listo para impresión/Supabase sin reamostrar ni perder fidelidad.

## Cómo se garantiza la fidelidad

- Se analiza la imagen con `sharp` respetando la orientación EXIF y verificando límites máximos de píxeles.
- Las imágenes JPEG se incrustan con su stream DCT original; las PNG se conservan en Flate lossless. Formatos alternativos (WebP/HEIC/AVIF) se convierten explícitamente a PNG sin reducción.
- Se preservan perfiles ICC embebidos o se añade un perfil sRGB IEC61966-2.1 a través de un OutputIntent e ICCBased para garantizar la consistencia de color.
- El PDF se construye con `pdf-lib` manteniendo 1:1 los píxeles; al conocer medidas físicas se respeta el tamaño real y se añade sangrado/margen configurable.
- Se pinta un fondo homogéneo (por defecto blanco) para evitar halos en zonas transparentes.

## Flags soportados

El método `imageBufferToPdf(options)` acepta los siguientes parámetros relevantes:

| Opción | Descripción | Predeterminado |
| --- | --- | --- |
| `bleedCm` | Sangrado por lado en centímetros. | `1` (equivalente a +2 cm total) |
| `background` / `bleedColor` | Color hex para fondo/bleed. | `#ffffff` |
| `targetPpi` | PPI para mapear px→pt cuando no hay medidas físicas. | `72` |
| `widthCm` / `heightCm` | Medida física del producto. Si existen se respeta el tamaño real y se recalcula el PPI efectivo. | `null` |
| `allowLossy` | Permite volver a comprimir si el PDF supera 250 MB. | `false` |
| `enforceSRGB` | Obliga a incrustar perfil sRGB cuando falte ICC. | `true` |
| `maxPixels` | Límite suave de resolución (abortamos si se excede). | `20 000 × 20 000` |
| `upscale` | Habilita upscale explícito (actualmente no se ejecuta si es `false`). | `false` |

El resultado expone métricas (`diagnostics`) con formato, ICC, PPI efectivos, SSIM/PSNR y si hubo recompressión, además de loguearse con `console.info('image_to_pdf_result', …)`.

## QA automático

Cada PDF genera una simulación de la página final a 600 ppi utilizando el raster incrustado y se compara contra el original remuestreado con la misma geometría:

- Si la incrustación fue sin reprocesar (JPEG) se verifica byte a byte que el stream coincida.
- En todos los casos se calculan **SSIM ≥ 0.99** y **PSNR ≥ 45 dB** usando `ssim.js`; si falla se levanta `qa_check_failed`.
- Cuando la geometría supera el límite de píxeles soportado por `sharp`, la simulación baja dinámicamente (hasta un mínimo de ~150 ppi) y se registra en `qa_density`.

## Cómo ejecutar la verificación manual

```bash
npm test -- --test-name-pattern image-to-pdf
```

El test crea artefactos en `tests/output/` y escribe en consola los logs con `orig_px`, `embedded_format`, `icc`, `qa`, etc., útiles para auditoría.

