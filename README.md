# MGM API

## Configuración de CORS

Establece la variable de entorno `ALLOWED_ORIGINS` como una lista separada por comas de orígenes sin barra final.

En Vercel debe contener **exactamente**:

```
ALLOWED_ORIGINS=http://localhost:5173,https://<tu-front>.vercel.app
```

Reemplaza `<tu-front>` con el nombre de tu deploy del front-end en Vercel.

## Upload de archivos

El endpoint `/api/upload-url` genera una URL firmada de Supabase Storage para subir el archivo original. El `object_key` sigue el formato:

```
original/YYYY/MM/<slug>-<WxH>-<MATERIAL>-<hash8>.<ext>
```

* `slug` es el `design_name` en minúsculas y sin acentos, con espacios reemplazados por `-`.
* `WxH` son las medidas en centímetros.
* `MATERIAL` es el material en mayúsculas.
* `hash8` son los primeros 8 caracteres del SHA-256 del archivo.

### Campos del POST `/api/upload-url`

```
{
  design_name: "Gato Surfista",
  ext: "png",
  mime: "image/png",
  size_bytes: 123456,
  material: "PRO",
  w_cm: 100,
  h_cm: 50,
  sha256: "<64 hex>"
}
```

La respuesta incluye `object_key` y la `signed_url` para realizar el `PUT` binario. La URL canónica del archivo original puede construirse como:

```
${VITE_SUPABASE_URL}/storage/v1/object/uploads/${object_key}
```

## Buckets

La aplicación utiliza dos buckets de Supabase Storage:

* `uploads`: privado, almacena los archivos originales subidos por el usuario.
* `outputs`: público, recibe los archivos generados (`preview.jpg`, `print.jpg` y `file.pdf`) por `/api/finalize-assets`.

## Moderación de imágenes

El endpoint `POST /api/moderate-image` analiza una miniatura (máx. 512px, JPEG) antes de subirla a
Supabase. Requiere enviar un `multipart/form-data` con el campo `image` y responde:

```
{ ok: true, diag_id: "...", allow: true|false, reasons: ["real_nudity","hate_symbol"], scores: { ... }, provider: "sightengine" }
```

Variables de entorno relacionadas:

```
MOD_PROVIDER=sightengine
SIGHTENGINE_USER=usuario
SIGHTENGINE_KEY=clave
MOD_NUDITY_BLOCK=0.85
MOD_SEXY_BLOCK=0.9
```

## Admin search de jobs

El endpoint `GET /api/admin/search-jobs` permite buscar trabajos por `job_id`,
`design_name`, `customer_email` o `file_hash`. Requiere enviar el header
`Authorization: Bearer ${WORKER_TOKEN}` y solo responde a los orígenes
permitidos por CORS.

Variables de entorno adicionales:

```
WORKER_TOKEN=tu_token_secreto
```

El frontend incluye una página en `/admin` donde se puede pegar el token una
sola vez (se guarda en `localStorage`) y realizar búsquedas, paginar y descargar
los archivos listos para impresión.
