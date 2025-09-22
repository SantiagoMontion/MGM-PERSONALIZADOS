import React from 'react';
import { Buffer } from 'buffer';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Home from './pages/Home.jsx';
import Confirm from './pages/Confirm.jsx';
import Creating from './pages/Creating.jsx';
import Result from './pages/Result.jsx';
import DevRenderPreview from './pages/DevRenderPreview.jsx';
import DevCanvasPreview from './pages/DevCanvasPreview.jsx';
import Mockup from './pages/Mockup.jsx';
import MousepadsPersonalizados from './pages/MousepadsPersonalizados.jsx';
import ComoFunciona from './pages/ComoFunciona.jsx';
import PreguntasFrecuentes from './pages/PreguntasFrecuentes.jsx';
import Busqueda from './pages/Busqueda.jsx';
import NotFound, { NotFoundBoundary } from './pages/NotFound.jsx';
import { OrderFlowProvider } from './store/orderFlow';
import { FlowProvider } from './state/flow.js';
import './globals.css';
import { HelmetProvider } from 'react-helmet-async';

if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

const routes = [
  {
    element: <App />,
    errorElement: <NotFoundBoundary />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/mousepads-personalizados', element: <MousepadsPersonalizados /> },
      { path: '/como-funciona', element: <ComoFunciona /> },
      { path: '/preguntas-frecuentes', element: <PreguntasFrecuentes /> },
      { path: '/busqueda', element: <Busqueda /> },
      { path: '/confirm', element: <Confirm /> },
      { path: '/mockup', element: <Mockup /> },
      { path: '/creating/:jobId', element: <Creating /> },
      { path: '/result/:jobId', element: <Result /> },
      { path: '*', element: <NotFound /> }
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
    <HelmetProvider>
      <OrderFlowProvider>
        <FlowProvider>
          <RouterProvider router={router} />
        </FlowProvider>
      </OrderFlowProvider>
    </HelmetProvider>
  </React.StrictMode>
);
