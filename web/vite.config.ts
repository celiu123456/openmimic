import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * The dev server proxies `/api` to the collection API on 7860, so the browser
 * always talks to one origin and the production build needs no base path.
 */
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7860',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
