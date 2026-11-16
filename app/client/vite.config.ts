import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Local dev only: drop the browser's "has this file changed?" headers, so the dev server always
// answers 200 with the file instead of 304 Not Modified.
const alwaysFullResponses: Plugin = {
  name: 'always-full-responses',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
      next();
    });
  },
};

export default defineConfig({
  plugins: [alwaysFullResponses, react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
