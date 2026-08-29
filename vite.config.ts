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
  build: {
    // The artifact build is one self-contained file, so its fonts have to be
    // base64 data URIs rather than emitted assets nothing would serve. The
    // normal build leaves them as separate files, which is what a real host
    // wants: they hash, cache forever, and don't bloat every page load.
    assetsInlineLimit: mode === 'artifact' ? 512 * 1024 : 4096,
  },
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
}));
