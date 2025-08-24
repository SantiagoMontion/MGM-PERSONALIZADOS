# cURL examples for MGM API

## 1. Obtain signed upload URL
```bash
curl -X POST https://mgm-api.vercel.app/api/upload-url \
  -H 'Content-Type: application/json' \
  -d '{
    "ext": "png",
    "mime": "image/png",
    "size_bytes": 123456,
    "material": "Classic",
    "w_cm": 10,
    "h_cm": 10,
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }'
```

La respuesta incluye `object_key` y `signed_url`.

## 2. Subir el archivo con el `signed_url`
```bash
curl -X PUT '<SIGNED_URL>' \
  -H 'Content-Type: image/png' \
  --data-binary '@local.png'
```

## 3. Enviar el job
```bash
curl -X POST https://mgm-api.vercel.app/api/submit-job \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-1' \
  -d '{
    "customer": { "email": "cliente@example.com", "name": "Cliente Demo" },
    "design_name": "Prueba",
    "publish_to_shopify": false,
    "material": "Classic",
    "size_cm": { "w": 10, "h": 10, "bleed_mm": 3 },
    "fit_mode": "cover",
    "bg": "#ffffff",
    "file_original_url": "https://vxkewodclwozoennpqqv.supabase.co/storage/v1/object/uploads/original/2025/08/job_20250824_6cf3a8da/0123456789abcdef.png",
    "file_hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "dpi_report": { "dpi": 300, "level": "ok" },
    "price": { "currency": "ARS", "amount": 1000 },
    "notes": "Job de prueba",
    "source": "curl"
  }'
```

## 4. Consultar estado del job
```bash
curl https://mgm-api.vercel.app/api/job-status?id=<JOB_ID>
```

## 5. Resumen del job
```bash
curl https://mgm-api.vercel.app/api/job-summary?id=<JOB_ID>
```
