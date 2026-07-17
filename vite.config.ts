import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  // mediabunny + its WASM extensions ship their own pre-bundled ESM; let Vite
  // resolve them as-is rather than pre-optimising (which can mangle the WASM url).
  optimizeDeps: {
    exclude: ['mediabunny', '@mediabunny/aac-encoder'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
