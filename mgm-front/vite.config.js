import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const devApiPort = process.env.DEV_API_PORT || process.env.API_PORT || '3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@/': fileURLToPath(new URL('./src/', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${devApiPort}`,
        changeOrigin: true,
        secure: false,
        // sin "rewrite": que /api/cart/start llegue al backend tal cual
      }
    }
  }
});
