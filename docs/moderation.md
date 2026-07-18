# Moderación de imágenes

Stack **gratuito**: filtro rápido en el cliente (`nsfwjs`) + verificación en el servidor (`sharp` + pHash + OCR con `tesseract.js`).

El servidor clasifica cada imagen en **BLOCK**, **REVIEW** o **ALLOW** y devuelve `label`, `reasons` y `confidence` (0–1). Solo **BLOCK** corta el flujo en el front (`ok: false`).

## Política (producción)

| Contenido | Acción |
|-----------|--------|
| Esvástica / símbolo nazi **directo y bien visible** | BLOCK |
| “Hitler” / términos nazis **directos** (nombre de archivo, nombre del diseño, OCR) | BLOCK |
| Símbolo pequeño / escondido / foto de guerra sin símbolo claro | ALLOW (no se persigue) |
| Personas vestidas / fotos normales | ALLOW |
| Desnudo de persona **real** explícito | BLOCK |
| Hentai / dibujo / anime | ALLOW |
| Casi todo lo demás | ALLOW |

**Límite:** sin clasificador facial, un retrato de Hitler **sin texto** no se bloquea de forma fiable. La prioridad es símbolo visible + texto/OCR.

## Flujo

1. Paso 2 → Confirmar (`handleContinue` en el front).
2. Cliente: keywords hate en filename + nombre del proyecto.
3. Cliente: `nsfwjs` (bloquea porn/sexy real; permite hentai/drawing dominante). Fail-open si timeout/error de carga.
4. Servidor: `POST /api/moderate-image` → `evaluateImage` (Vercel entry: `api/moderate-image.ts` → `api-routes/moderate-image.js`).

## Servidor – nazismo

- **pHash** con `fit: cover` (centro) contra templates SVG de esvástica (varios strokes, invertidos, bandera). Evita aplastar pads 90×40.
- **Shape fuerte solo** (match muy cercano) → BLOCK sin exigir otras señales.
- **Paleta de bandera solo** (rojo dominante + disco blanco + negro en centro) → BLOCK (cubre banderas estiradas a full-bleed).
- Señales medias: hace falta **2 de 3** (shape / palette / texto) para bajar falsos positivos (manji).
- No se padean pads anchos con bandas blancas (diluían la paleta).
- Texto: lista en `lib/moderation/hate.js` sobre filename, designName y OCR.

## Servidor – desnudos

- Solo aplica reglas de nudez si la imagen parece **persona real** (`isRealPerson`).
- Ilustración / hentai / anime → ALLOW por ese gate.

## Variables opcionales

```
MOD_PREVIEW_LIMIT_BYTES=2000000
MOD_BODY_LIMIT_BYTES=8388608
MODERATION_SKIP_OCR=1
MODERATION_ENABLE_OCR=1
MODERATION_OCR_TIMEOUT_MS=8000
```

- `MODERATION_SKIP_OCR=1`: fuerza sin OCR (local/CI).
- En **Vercel**, el OCR está **apagado por defecto** (Tesseract cuelga cold starts). Filename + nombre del diseño siguen filtrando “Hitler”. Activar solo con `MODERATION_ENABLE_OCR=1`.
- El detector visual nazi hace **early exit** (no espera OCR/skin) cuando ya hay BLOCK claro.

## Prueba local rápida

```bash
node scripts/test-moderation-synthetic.mjs
node scripts/test-wide-nazi-flag.mjs
```

Espera BLOCK en esvástica sintética, filename `hitler.png` y banderas 90×40 (incl. fotos/JPEG con blanco crema); ALLOW en un lienzo blanco inocente.

La paleta usa resolución mayor, blanco/crema laxo, “agujero rojo” en el centro y varios centros (por reposicionado).
