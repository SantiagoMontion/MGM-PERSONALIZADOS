# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Variables de entorno

Antes de iniciar el entorno de desarrollo crea un archivo `.env` con:

```
VITE_API_BASE=URL_de_tu_API
VITE_SUPABASE_URL=URL_de_tu_proyecto_Supabase
VITE_SUPABASE_ANON_KEY=clave_anon_de_Supabase
VITE_ENABLE_MODERATION=true
VITE_MODERATION_DRYRUN=false
VITE_SHOW_MOD_SCORES=false
```

Luego ejecuta `npm run dev` para iniciar el frontend.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
