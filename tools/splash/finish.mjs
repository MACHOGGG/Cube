/**
 * vite 出的是 tools/splash/dist/index.html。把它挪成一个名字说得清的文件，
 * 顺手报一下多大——这一份是要发给人的，大小得心里有数。
 */
import { copyFileSync, statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'dist', 'index.html');
const out = join(here, 'splash.html');
copyFileSync(src, out);
rmSync(join(here, 'dist'), { recursive: true, force: true });
console.log(`开场动画出好了：tools/splash/splash.html（${Math.round(statSync(out).size / 1024)}KB）`);
console.log('双击就放。?size=2160 换更大的画布，?loop=0 只放一遍。');
