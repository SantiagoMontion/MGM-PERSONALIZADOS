# Vercel deployment

Este proyecto utiliza **Node.js 20** para las funciones en `/api/**` y un frontend Vite en `mgm-front`.

- **Root Directory:** raíz del repo (`.`)
- **Install Command:** `npm install`
- **Build Command:** `npm run build`
- **Output Directory:** `mgm-front/dist`

El archivo `vercel.json` en la raíz define `nodejs20.x` como runtime para todas las funciones.
