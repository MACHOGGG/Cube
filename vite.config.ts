import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode artifact` produces one self-contained dist/index.html
// (JS/CSS inlined, no separate chunk files) for publishing as a quick
// shareable preview. The normal `vite build` stays multi-file, which is what
// the PWA service worker and real hosting want.
export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    host: true,
  },
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
}));
