# SEO

Las metas principales se definen en `mgm-front/index.html`. Para editar los metadatos por página utiliza [`react-helmet`](https://github.com/nfl/react-helmet) dentro de cada componente en `src/pages`. Allí puedes cambiar `<title>`, `description`, `canonical` y etiquetas Open Graph/Twitter.

El sitemap y `robots.txt` se encuentran en `mgm-front/public/`. Si agregas nuevas rutas actualiza `sitemap.xml` manualmente y vuelve a desplegar.

Para regenerar o validar SEO ejecuta en el frontend:

```bash
npm run build
```

Esto generará los archivos estáticos listos para Vercel.
