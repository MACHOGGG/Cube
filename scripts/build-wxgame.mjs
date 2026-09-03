/**
 * 把 wxgame/src 打成微信小游戏要的那一个 game.js。
 *
 *   node scripts/build-wxgame.mjs        （package.json 里也叫 npm run build:wxgame）
 *
 * 先做类型检查（wxgame/tsconfig.json：小游戏自己的源码 + 从网页版借来的四个
 * 引擎文件），再用 esbuild 打成一个不依赖 DOM 的 iife——微信小游戏的入口
 * 就是根目录那一个 game.js。
 */
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

execSync('npx tsc -p wxgame/tsconfig.json', { stdio: 'inherit' });
await build({
  entryPoints: ['wxgame/src/main.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2018'],
  outfile: 'wxgame/game.js',
  legalComments: 'none',
  banner: { js: '// 由 scripts/build-wxgame.mjs 从 wxgame/src 打包生成，不要手改。' },
});
console.log('wxgame/game.js 打好了');
