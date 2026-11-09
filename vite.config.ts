import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const offlinePrecacheManifest: Plugin = {
  name: 'offline-precache-manifest',
  apply: 'build',
  generateBundle(_options, bundle) {
    const files = new Set<string>();
    const visitedChunks = new Set<string>();
    const addStaticChunkGraph = (fileName: string) => {
      if (visitedChunks.has(fileName)) return;
      visitedChunks.add(fileName);
      const output = bundle[fileName];
      if (!output || output.type !== 'chunk') return;
      files.add(output.fileName);
      // Include static imports required to boot the entry while leaving
      // dynamicImports out. Lazy route chunks are cached on first use.
      for (const importedFile of output.imports) addStaticChunkGraph(importedFile);
    };
    for (const output of Object.values(bundle)) {
      if (output.type === 'chunk' && output.isEntry) addStaticChunkGraph(output.fileName);
      // The app currently emits one shared stylesheet; include styles/fonts
      // but do not pre-cache lazy JavaScript chunks.
      if (output.type === 'asset' && /\.(?:css|woff2?|ttf|otf)$/.test(output.fileName)) files.add(output.fileName);
    }
    this.emitFile({
      type: 'asset',
      fileName: 'precache-manifest.json',
      source: JSON.stringify({ files: [...files].sort() }),
    });
  },
};

export default defineConfig({
  // Relative asset paths work for both a domain root and GitHub Pages project paths.
  base: './',
  plugins: [react(), offlinePrecacheManifest],
  // Zustand's React bindings must resolve the exact same React runtime as ReactDOM.
  // This prevents a null hook dispatcher when dependency trees contain duplicate React copies.
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', 'zustand'] },
  build: { outDir: 'dist', sourcemap: false, manifest: true },
});
