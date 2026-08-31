/**
 * Build-time configuration, injected by Vite from the environment (Vercel's
 * project settings in production, a local .env otherwise). Every one of
 * these is optional: with none of them set the app is exactly what it was
 * before analytics existed, which is what the artifact and offline builds
 * want.
 *
 * Nothing about Creem appears here. The api/ functions hold both the key and
 * the product ids, and the browser only ever names a billing period — so the
 * bundle carries no payment configuration of any kind, secret or otherwise.
 */
interface ImportMetaEnv {
  /** Google Analytics 4 measurement id, e.g. "G-XXXXXXXXXX". Empty = GA off. */
  readonly VITE_GA_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
