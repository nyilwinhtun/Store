import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const offlinePrecacheManifest: Plugin = {
  name: 'offline-precache-manifest',
  apply: 'build',
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle).filter((fileName) => /\.(?:js|css|woff2?|ttf|otf|svg|png|webp|jpe?g)$/.test(fileName));
    this.emitFile({
      type: 'asset',
      fileName: 'precache-manifest.json',
      source: JSON.stringify({ files }),
    });
  },
};

export default defineConfig({
  // Relative asset paths work for both a domain root and GitHub Pages project paths.
  base: './',
  plugins: [react(), offlinePrecacheManifest],
  build: { outDir: 'dist', sourcemap: false },
});
