import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import Home from './pages/Home.jsx';
import Confirm from './pages/Confirm.jsx';
import Creating from './pages/Creating.jsx';
import Result from './pages/Result.jsx';
import DevRenderPreview from './pages/DevRenderPreview.jsx';
import DevCanvasPreview from './pages/DevCanvasPreview.jsx';
import ErrorPage from './ErrorPage.jsx';
import './globals.css';

const routes = [
  {
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/confirm', element: <Confirm /> },
      { path: '/creating/:jobId', element: <Creating /> },
      { path: '/result/:jobId', element: <Result /> }
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
    <RouterProvider router={router} />
  </React.StrictMode>
);
