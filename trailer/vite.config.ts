import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Serves the trailer renderer; it imports the game's modules directly from ../src (read-only).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { port: 5310, strictPort: true, hmr: false, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
});
