import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Home from './pages/Home.jsx';
import Confirm from './pages/Confirm.jsx';
import Result from './pages/Result.jsx';
import Admin from './pages/Admin.jsx';
import MisDisenos from './pages/MisDisenos.jsx';
import Terminos from './pages/legal/Terminos.jsx';
import Privacidad from './pages/legal/Privacidad.jsx';
import Contenido from './pages/legal/Contenido.jsx';
import Devoluciones from './pages/legal/Devoluciones.jsx';
import DMCA from './pages/legal/DMCA.jsx';
import DevRenderPreview from './pages/DevRenderPreview.jsx';
import DevCanvasPreview from './pages/DevCanvasPreview.jsx';
import ErrorPage from './ErrorPage.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { initSentry } from './sentry';
import './globals.css';

initSentry();

const routes = [
  {
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/confirm', element: <Confirm /> },
      { path: '/result/:jobId', element: <Result /> },
      { path: '/admin', element: <Admin /> },
      { path: '/mis-disenos', element: <MisDisenos /> },
      { path: '/legal/terminos', element: <Terminos /> },
      { path: '/legal/privacidad', element: <Privacidad /> },
      { path: '/legal/contenido', element: <Contenido /> },
      { path: '/legal/devoluciones', element: <Devoluciones /> },
      { path: '/legal/dmca', element: <DMCA /> }
    ]
  }
];

if (import.meta.env.DEV) {
  routes[0].children.push({ path: '/dev/render-preview', element: <DevRenderPreview /> });
  routes[0].children.push({ path: '/dev/canvas-preview', element: <DevCanvasPreview /> });
}

const router = createBrowserRouter(routes);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </React.StrictMode>
);
