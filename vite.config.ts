// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
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
