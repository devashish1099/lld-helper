import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = `http://127.0.0.1:${process.env.LLD_PORT ?? 4173}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 8000, sourcemap: false },
  worker: { format: 'es' },
});
