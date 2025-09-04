Este proyecto (APIs) se despliega desde la **raíz**.

En Vercel configura:
- Framework: "Other"
- Build Command: (vacío) o `npm run vercel-build`
- Output Directory recomendado: `.`
- Node.js: 20.x
- Mientras el Output Directory en el Dashboard siga en `public`, la carpeta mínima `public/` evita el error.

El front (`mgm-front`) se despliega en otro proyecto con Root Directory=`mgm-front`.
