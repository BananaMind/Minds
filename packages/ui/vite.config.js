import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build loads from file:// inside Electron and from a mobile webview.
export default defineConfig({ base: './', plugins: [preact()], build: { outDir: 'dist', chunkSizeWarningLimit: 800 } });
