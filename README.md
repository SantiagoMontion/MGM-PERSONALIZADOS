# MGM API

## Configuración de CORS

Establece la variable de entorno `ALLOWED_ORIGINS` como una lista separada por comas de orígenes sin barra final.

En Vercel debe contener **exactamente**:

```
ALLOWED_ORIGINS=http://localhost:5173,https://<tu-front>.vercel.app
```

Reemplaza `<tu-front>` con el nombre de tu deploy del front-end en Vercel.
