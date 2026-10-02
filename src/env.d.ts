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
  /**
   * Vite 自己填的那一位：`npm run dev` 下是 true，`npm run build` 出来的包里是 false。
   *
   * 它是**构建时替换掉的常量**，所以 `if (!import.meta.env.DEV) return null;` 这种写法在
   * 正式包里整段被摇掉——不是「运行时判断一下」，是根本不在产物里。
   * `engine/devDeal.ts`（开发时手摆一副牌）靠的就是这一点：那个入口在线上等于一个作弊器，
   * 而排行榜是真的。
   */
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  /**
   * Vite's build-time folder read, used by ui/customIcons.ts to slurp
   * src/assets/icons/*.svg. Declared here rather than by referencing
   * vite/client, to keep this file the single place that says what the
   * bundler hands the app — the same reason ImportMetaEnv is spelled out
   * above instead of inherited.
   */
  glob(
    pattern: string,
    options: { query: '?raw'; import: 'default'; eager: true },
  ): Record<string, string>;
}
