# Moderación de imágenes

El pipeline de moderación combina verificaciones estrictas para extremismo y desnudez real, e inhibidores para reducir falsos positivos con fondos rosados/mapas.

## Flujo general

1. **Símbolos nazis** – Se ejecuta siempre primero. Plantillas `pHash` + correlación normalizada para distintos ángulos y variantes (banderas, invertidos). Si la confianza ≥ `SWASTIKA_DET_THRESH` o hay ≥ 2 coincidencias medias, se bloquea. Los `boundingBoxes` detectados se registran en los logs.
2. **Clasificador real vs. ilustración** – Heurística basada en paleta/edges; si la probabilidad de foto real es `< REALNESS_THRESH` se permite inmediatamente (sin pasar por NSFW) pero se sigue monitoreando símbolos nazis.
3. **Detección de piel/personas** – Se obtiene la máscara de piel (`sharp` en 256px) y se derivan candidatos de persona cuando los blobs son suficientemente grandes (≥2 % del frame) y con confianza ≥ `PERSON_DET_THRESH`.
4. **NSFW (desnudez real)** – Sólo se evalúa cuando hay foto real **y** personas detectadas. El puntaje heurístico debe superar `NSFW_THRESH` y además pasar tres compuertas:
   - `SKIN_RATIO_IN_PERSON` (mínimo 12 % de piel dentro de cada bbox),
   - `SKIN_LARGE_REGION` (≥20 000 px aproximados en la región contigua mayor),
   - `SKIN_INTERSECTION` (≥60 % de la máscara de piel dentro de las personas).
5. **Inhibidores “rosa”** – Antes de confirmar el bloqueo por NSFW se revisan: dominancia rosa sin personas, OCR con ≥100 tokens y ≥5 topónimos, alta densidad de bordes finos sin blobs grandes y consistencia global de piel (fondos planos). Si alguno aplica, se permite la imagen y se archiva (opcional) en Supabase bajo `fp-rosa/<fecha>`.

Los resultados finales son `ALLOW` o `BLOCK` (no usamos `REVIEW` en la API). Cada respuesta incluye `label`, `reasons`, `confidence` y `details` para depuración.

## Configuración

Los umbrales viven en [`lib/moderation/config.js`](../lib/moderation/config.js) y se pueden ajustar vía variables de entorno (prefijo `MOD_...`). Ejemplo:

```
MOD_SWASTIKA_DET_THRESH=0.6
MOD_REALNESS_THRESH=0.6
MOD_PERSON_DET_THRESH=0.5
MOD_NSFW_THRESH=0.7
MOD_SKIN_RATIO_IN_PERSON=0.12
MOD_SKIN_LARGE_REGION=20000
MOD_SKIN_INTERSECTION=0.6
MOD_PINK_DOMINANCE=0.55
MOD_OCR_TOKEN_MIN=100
MOD_OCR_GEOS_MIN=5
MODERATION_STRICT=false    # eleva NSFW a 0.75 si suben los falsos positivos
MODERATION_SKIP_OCR=1      # solo para CI/local; salta OCR
```

El flag `MODERATION_STRICT=false` relaja el umbral NSFW a 0.75 sin redeploy.

## Logs y métricas

Cada verificación escribe `console.info('moderation.image', {...})` con los campos claves: `{hasPerson, nsfw, skinInPerson, pinkRatio, ocrTokens, geoHits, naziScore, decision}`. Esto permite exportar métricas a herramientas externas (Datadog, Logflare, etc.).

## QA

El script [`scripts/moderation-qa-report.mjs`](../scripts/moderation-qa-report.mjs) procesa un dataset anotado (`annotations.json`) y reporta precisión/recall junto con la lista de falsos positivos corregidos por los inhibidores rosa. Ejecutar:

```
node scripts/moderation-qa-report.mjs tests/moderation/qa
```

El JSON de salida incluye `totals`, `precision`, `recall` y los archivos corregidos.

## Cliente

El front usa `nsfwjs` de manera perezosa para bloquear casos evidentes antes de subirlos, pero la decisión final siempre proviene del endpoint `POST /api/moderate-image`.

## Objetivo

Mantener bloqueados los desnudos de personas reales y cualquier símbolo nazi (en cualquier estilo) mientras se reducen los falsos positivos típicos de fondos o mapas rosados.
