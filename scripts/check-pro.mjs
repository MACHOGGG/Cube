/**
 * 《Pro》：固定翻色只在单人局、发牌不碰随机数（10-15 补充 S10：K-4，站长 2026-10-14 定的新 Pro）。
 *
 *   node scripts/check-pro.mjs            # 读源码 + 当场打包 engine/proCycle.ts 实跑
 *   node scripts/check-pro.mjs --mutants  # 尺子：把源码改坏几处（只在内存里改），对应那几条必须红
 *
 * 不起服务器、不开浏览器。这件事的要害有三条，错了都不报错、不白屏：
 *   · **非 Pro 局的牌不许变**。Pro 只能在 generate*() 发完牌之后改写反面——挪到发牌之前、或者在改写时多取一个
 *     随机数，同一串代号就发出另一副牌（每日挑战、输代号、小屋全都对不上），而屏幕上只是「一副普通的牌」。
 *   · **只在单人局**。每日挑战、输代号、小屋一律照普通规则发牌；少了 launchSeedGame 那一句 proAllowed: false，
 *     开着 Pro 的人打每日挑战，翻出来的颜色和别人不一样，榜上的分数就不是同一副牌打出来的。
 *   · **开局那一刻定**：局中开关锁住，旁边写明原因。
 *
 * 从前（2026-09 起）这道门量的是每枚色块外侧那一圈描边（engine/proHint.ts），10-14 改版时那一套整个删了，这道门
 * 跟着重写；原来的第 ⑧ 条（--mark-edge 那三条）和这次改版无关，原样留着。界面那一半（轮盘摆在哪儿、箭头淡不淡、
 * 锁住了拨不拨得动）由 check-pro-wheel.mjs 管，那一道要开浏览器。
 *
 * 10-31 方案推14 Z-B13（站长 10-21/22、10-30）起 Pro 还多了一套规则，加 ⑨–⑫ 四节：
 *   ⑨ **冻结在起始图案**：Pro 局侵蚀照扣段、不降级（erosion.reset({ frozen })）；
 *   ⑩ **卡死时松一级**：只在 Pro 局、盘上还有正面色块、判死、还没到这一局的最低级时松（普通棋盘 1×2、老虎机 1 枚）；
 *      五副外边族的 stuckAt、方块的 findStuckGroups 都包着 controller.relaxIfStuck——只在控制器那一句问的话，收尾放开
 *      先把星星削光，剩下那一两枚色块再也滑不动（pro-score §1.3 第 3 条）；
 *   ⑪ **Pro 基准步数 = ⌈普通 par × 1.5⌉**，服务器手抄的 proPar 一列跟它逐位对上（对不上，Pro 局的综合分被判 coef）；
 *   ⑫ **教学局一律按普通打**：教学局不开 Pro，教学局之后的《再来一局》照常开（假 DOM 里真开两局量）。
 * 这几样错了都不报错：Pro 局图案悄悄变小（等于没开 Pro），或者卡死了不松、剩的色块永远翻不掉被九折。
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { makeSim } from './lib/endDetectBundle.mjs';
import * as MS from '../api/_maxscore.js';

const MUTANTS = process.argv.includes('--mutants');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/** 六副棋盘：键是**文件名**（`shapes/triangle.ts` 的 card id 是 triangleBig，认文件不认 id）。 */
const BOARDS = ['square', 'squareDiamond', 'circle', 'circleHex', 'circleSeven', 'triangle'];
/** 发牌那一行的原文（改版前的基线）。Pro 不许碰它一个字。 */
const BOMB_DEAL = 'grid = isBomb ? generateCleanBombBoard(() => boardFromBombDeck(shuffledDeck()), hasInitialClump, BOMB_ADJ, liveBomb) : generateCleanBoard();';
const DEAL_LINE = {
  square: BOMB_DEAL,
  squareDiamond: BOMB_DEAL,
  circle: BOMB_DEAL,
  circleHex: BOMB_DEAL,
  circleSeven: 'grid = generateCleanBoard();',
  triangle: BOMB_DEAL,
};
const RED_ARG = { circleSeven: '-1' };

/** 读源码的那几条，收一个「文件 → 文本」的表，好让尺子在内存里改坏它再跑一遍。 */
function sources() {
  const out = {};
  for (const b of BOARDS) out[`src/shapes/${b}.ts`] = read(`src/shapes/${b}.ts`);
  for (const p of [
    'src/engine/proMode.ts',
    'src/engine/proCycle.ts',
    'src/engine/gameController.ts',
    'src/engine/erosion.ts',
    'src/main.ts',
    'src/ui/gameShell.ts',
    'src/ui/accountPage.ts',
    'src/i18n.ts',
    'src/style.css',
  ])
    out[p] = read(p);
  return out;
}

function sourceChecks(src, check) {
  // ---- ① 设置本身：记在本机、默认关；描边那一套没回来 ----
  {
    const mod = src['src/engine/proMode.ts'];
    check('① 设置记在本机（slides_pro）', /const KEY = 'slides_pro'/.test(mod));
    check('① 默认是关的（读不到就当没开）', /return localStorage\.getItem\(KEY\) === '1'/.test(mod));
    check('① 存不下也不崩（无痕模式）', /catch \{[\s\S]{0,120}return false/.test(mod));
    check('① proMode 不再往 <html> 上挂 data-pro、不再有 onProChange（局中没有谁要跟着它变）',
      !/data-pro/.test(mod.replace(/^\s*\*.*$/gm, '')) && !/export function onProChange/.test(mod));
    check('① engine/proHint.ts 删掉了', !existsSync(new URL('../src/engine/proHint.ts', import.meta.url)));
    const css = ['square', 'circle', 'triangle'].map((f) => read(`src/shapes/${f}.css`)).join('\n');
    check('① 三份 shapes/*.css 里没有 .pro- 的规则', !/^\.pro-/m.test(css));
  }

  // ---- ③ 六副棋盘：发完牌之后才改写反面，发牌那一行一个字不动 ----
  for (const b of BOARDS) {
    const s = src[`src/shapes/${b}.ts`];
    const at = s.indexOf('function resetBoard(deal');
    const body = at < 0 ? '' : s.slice(at, s.indexOf('\n      }\n', at));
    const calls = body.match(/if \(deal\?\.pro\) applyProBacks\(/g) ?? [];
    const iDeal = body.indexOf(DEAL_LINE[b]);
    const iPro = body.indexOf('if (deal?.pro) applyProBacks(');
    const iDev = body.indexOf('devDealFor(');
    check(`③ [${b}] resetBoard 收 deal，里头恰好一次 if (deal?.pro) applyProBacks(`, at >= 0 && calls.length === 1, `${calls.length} 次`);
    check(`③ [${b}] 发牌那一行和基线逐字相同`, iDeal >= 0, iDeal >= 0 ? '' : '没找到原文那一行');
    check(`③ [${b}] 改写排在发牌之后、手摆的牌（devDealFor）之前`, iDeal >= 0 && iPro > iDeal && iDev > iPro, `发牌 ${iDeal} · Pro ${iPro} · devDeal ${iDev}`);
    const red = RED_ARG[b] ?? 'isBomb ? RED_IDX : -1';
    check(`③ [${b}] 这一圈按标准调色板的色数、炸弹局去红（${red}）`,
      body.includes(`applyProBacks(grid, proCycle(PALETTES.standard.length, ${red}))`));
    check(`③ [${b}] 交给控制器 proAllowed: opts?.proAllowed 和 proView`, /proAllowed: opts\?\.proAllowed,/.test(s) && /proView: \(\) => \(\{/.test(s));
    check(`③ [${b}] 文件里没有 proOn（开不开由控制器在开局那一刻定，棋盘不自己问）`, !/\bproOn\b/.test(s));
  }

  // ---- ④ 资格：只有单人入口给；每日、代号显式 false；小屋、小红书不给；控制器开局那一刻定 ----
  {
    const main = src['src/main.ts'];
    const fn = (name) => {
      const at = main.indexOf(`function ${name}(`);
      if (at < 0) return '';
      const next = main.indexOf('\nfunction ', at + 10);
      return main.slice(at, next < 0 ? undefined : next);
    };
    const show = fn('showGame');
    check('④ showGame：proAllowed: true 写在 ...opts 之前（每日、代号那条盖得过它）',
      show.includes('proAllowed: true,') && show.indexOf('proAllowed: true,') < show.indexOf('...opts,'));
    const seed = fn('launchSeedGame');
    check('④ launchSeedGame：proAllowed: false 写在 ...teach 之后', /\.\.\.teach,[^}]*proAllowed: false/.test(seed));
    const mp = fn('startMultiplayerRun');
    check('④ startMultiplayerRun 不给 proAllowed', mp.length > 0 && !/proAllowed:/.test(mp));
    let xhsHit = '';
    for (const f of ['main.ts', 'menu.ts', 'profile.ts']) {
      const p = `xhs/src/${f}`;
      if (existsSync(new URL('../' + p, import.meta.url)) && /proAllowed/.test(read(p))) xhsHit += p + ' ';
    }
    check('④ 小红书那一端不给 proAllowed', !xhsHit, xhsHit || '干净');
    const ctl = src['src/engine/gameController.ts'];
    const line = /^ *runPro = .*$/m.exec(ctl)?.[0] ?? '';
    check('④ 控制器 runPro 那一行同时问 proAllowed、proOn()、种子是随手抽的',
      line.includes('hooks.proAllowed') && line.includes('proOn()') && line.includes("'random'"), line.trim());
    const iPlant = ctl.indexOf('    plantSeed();\n    dealt++;');
    const iRun = ctl.indexOf(line);
    const iReset = ctl.indexOf('hooks.resetBoard({ pro: runPro });');
    check('④ 顺序：plantSeed() → runPro = … → resetBoard({ pro: runPro })', iPlant >= 0 && iRun > iPlant && iReset > iRun, `${iPlant} · ${iRun} · ${iReset}`);
    check('④ 局中锁开关：开局那一刻 refs.proSwitch.lock(…)', /refs\.proSwitch\.lock\(hooks\.proAllowed \? s\.proLockedNote : s\.proNotHereNote\)/.test(ctl));
    check('④ data-pro-run 用 set/removeAttribute（不用 toggleAttribute：Chrome 61 没有）',
      /setAttribute\('data-pro-run', '1'\)/.test(ctl) && /removeAttribute\('data-pro-run'\)/.test(ctl) && !/toggleAttribute\('data-pro-run'/.test(ctl));
    check('④ 存档里写 pro: runPro ? true : undefined', /pro: runPro \? true : undefined,/.test(ctl));
  }

  // ---- ⑤ 开关：锁住时第一句就回、用 aria-disabled；四语都有那四个新键 ----
  {
    const shell = src['src/ui/gameShell.ts'];
    check('⑤ 暂停面板那颗：点击处理第一句 if (proLocked) return',
      /proBtn\?\.addEventListener\('click', \(\) => \{\s*if \(proLocked\) return;/.test(shell));
    check('⑤ 锁住用 aria-disabled（不用 disabled：读屏还要读得到原因）',
      /setAttribute\('aria-disabled', 'true'\)/.test(shell) && !/proBtn\.disabled = true/.test(shell));
    check('⑤ 按钮里有那一段说明 #proNote', /id="proNote" hidden/.test(shell));
    check('⑤ 个人主页那一行：外观不改，加 title 和读屏说明', /id="proRow"[\s\S]{0,200}title="\$\{s\.proRowHint\}" aria-describedby="proRowHint"/.test(src['src/ui/accountPage.ts']) && /id="proRowHint"/.test(src['src/ui/accountPage.ts']));
    const i18n = src['src/i18n.ts'];
    for (const k of ['proLockedNote', 'proNotHereNote', 'proRowHint', 'proWheelLabel']) {
      const hits = i18n.match(new RegExp(`^ {4}${k}: '[^']+',$`, 'gm')) ?? [];
      check(`⑤ 四种语言都写了 ${k}`, hits.length === 4 && new RegExp(`^ {2}${k}: string;$`, 'm').test(i18n), `${hits.length} 处`);
    }
  }

  // ---- ⑧ 得分图示那一圈描边：浅色描黑、深色描白（原 ⑧，和这次改版无关，原样留着） ----
  {
    /*
     * 玩家 2026-09：「在浅色模式的时候得分图案的边框需要是黑色的，在深色模式的时候才是
     * 白色的。」那正是 :root 上 --mark-edge 的定义。上一版为了去掉「不该出现的黑边」，把
     * 棋盘上方那一排图示的 --mark-edge 改成了底色——描出来是一道看不见的缝，玩家要的黑边
     * 没了。
     */
    const css = src['src/style.css'];
    check('⑧ 浅色那一套描的是深色', /^ {2}--mark-edge: #2E2430;$/m.test(css));
    const darkHits = (css.match(/--mark-edge: #FFFFFF;/g) ?? []).length;
    check('⑧ 深色那几套描的是白色', darkHits >= 2, `${darkHits} 处`);
    const overrides = css.match(/--mark-edge: var\(--(?:play-)?bg\)|--mark-edge: var\(--surface\)/g) ?? [];
    check('⑧ 没有人把它按成底色（那等于没画）', overrides.length === 0, overrides.join(' '));
    check('⑧ 老虎机那一窗照旧自己写死深色（玩家点名要的）', /\.slot-reel \{[\s\S]{0,400}--mark-edge: #2E2430;/.test(css));
  }

  // ---- ⑨ 冻结：开局那一刻按 runPro 定（源码那一半；实跑在 runtimeChecks）----
  {
    const ctl = src['src/engine/gameController.ts'];
    check('⑨ newGame 里 erosion.reset({ frozen: !!hooks.flip || runPro })（无限反转照旧冻结，Pro 局也冻结）',
      ctl.includes('erosion.reset({ frozen: !!hooks.flip || runPro });'));
    const iRun = ctl.search(/^ *runPro = /m);
    const iReset = ctl.indexOf('erosion.reset({ frozen: !!hooks.flip || runPro });');
    check('⑨ 顺序：runPro 先定、再 reset 侵蚀', iRun >= 0 && iReset > iRun, `${iRun} · ${iReset}`);
  }

  // ---- ⑩ 松级：控制器的 relaxIfStuck ＋ 六副棋盘的卡死判定都包着它 ----
  {
    const ctl = src['src/engine/gameController.ts'];
    check('⑩ 普通棋盘的最低级 EROSION_FLOOR 是 2（1×2）', /^export const EROSION_FLOOR = 2;$/m.test(ctl));
    const at = ctl.indexOf('relaxIfStuck(check: () => Cell[][]): Cell[][] {');
    const body = at < 0 ? '' : ctl.slice(at, ctl.indexOf('return g;', at));
    check('⑩ 控制器上有 relaxIfStuck(check)', at >= 0);
    check('⑩ relaxIfStuck 只在 Pro 局松（问 runPro）', /\brunPro\b/.test(body));
    check('⑩ relaxIfStuck 的最低级：老虎机 1 枚、普通棋盘 EROSION_FLOOR（hooks.slot ? 1 : EROSION_FLOOR）',
      body.includes('erosion.level() > (hooks.slot ? 1 : EROSION_FLOOR)'));
    check('⑩ relaxIfStuck 只在盘上还有正面色块时松（neverFlipped > 0）', /neverFlipped \?\? 0\) > 0/.test(body));
    check('⑩ relaxIfStuck 松一级用 erosion.release()、松完重画图案、再问一遍', /erosion\.release\(\);\s*paintPattern\(\);[\s\S]*g = check\(\);/.test(body));
    for (const b of ['circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle']) {
      const f = src[`src/shapes/${b}.ts`];
      check(`⑩ [${b}] stuckAt 是 controller.relaxIfStuck(() => stuckAtRaw(threshold))`,
        /function stuckAt\(threshold: number\): Cell\[\]\[\] \{\s*return controller\.relaxIfStuck\(\(\) => stuckAtRaw\(threshold\)\);/.test(f));
    }
    check('⑩ [square] findStuckGroups 是 controller.relaxIfStuck(() => findStuckGroupsRaw())',
      /function findStuckGroups\(\): Cell\[\]\[\] \{\s*return controller\.relaxIfStuck\(\(\) => findStuckGroupsRaw\(\)\);/.test(src['src/shapes/square.ts']));
    check('⑪ 结算的基准步数：Pro 局用 proParOf(erosion.par())', ctl.includes('const par = runPro ? proParOf(erosion.par()) : erosion.par();'));
  }

  // ---- ⑫ 教学局一律按普通打（站长 10-30）----
  {
    const ctl = src['src/engine/gameController.ts'];
    const line = /^ *runPro = .*$/m.exec(ctl)?.[0] ?? '';
    check('⑫ runPro 那一句里有 !(hooks.coach && !coachDealt)（教学局不开 Pro）', line.includes('!(hooks.coach && !coachDealt)'), line.trim());
    check('⑫ coachDealt 只在头一局建教学条时立起来', /if \(hooks\.coach && refs\.coachEl && !coachDealt\) \{\s*coachDealt = true;/.test(ctl));
  }
}

/** ② 打包 proCycle.ts（连同 rng.ts）实跑。 */
async function runtimeChecks(check) {
  const src = read('src/engine/proCycle.ts');
  check('② proCycle.ts 不 import ./rng（一个随机数都不许取）', !/from '\.\/rng'/.test(src) && !/\brandom\(/.test(src.replace(/^\s*(\*|\/\/).*$/gm, '')));
  const dir = mkdtempSync(join(tmpdir(), 'check-pro-'));
  try {
    const entry = join(dir, 'entry.ts');
    const root = new URL('../src/engine/', import.meta.url).pathname;
    // 一份入口同时拿到 proCycle 和 rng：两者共用同一个打包出来的 rng 状态。
    const code = `export * from ${JSON.stringify(root + 'proCycle.ts')};\nexport { seedRandom, random, clearSeed } from ${JSON.stringify(root + 'rng.ts')};\n`;
    writeFileSync(entry, code);
    const out = join(dir, 'bundle.mjs');
    buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
    const m = await import(pathToFileURL(out).href);

    let ok = true;
    let why = '';
    for (const n of [4, 6, 7]) {
      for (const red of [-1, 0, 1]) {
        const cyc = m.proCycle(n, red);
        const want = Array.from({ length: n }, (_, i) => i).filter((i) => i !== red);
        if (cyc.join() !== want.join()) {
          ok = false;
          why = `proCycle(${n}, ${red}) = ${cyc}`;
        }
        // 走一整圈回到自己
        for (const start of cyc) {
          let c = start;
          for (let k = 0; k < cyc.length; k++) c = m.proNext(cyc, c);
          if (c !== start) {
            ok = false;
            why = `proNext 从 ${start} 走 ${cyc.length} 步没回到自己`;
          }
        }
        if (red >= 0 && m.proNext(cyc, red) !== red) {
          ok = false;
          why = `红（${red}）不在圈里却被换了`;
        }
        if (m.proNext(cyc, -1) !== -1) {
          ok = false;
          why = '空位 -1 被换了';
        }
      }
    }
    check('② 色数 {4,6,7} × 红 {−1,0,1}：去红保序、proNext 走一整圈回到自己、红和 −1 原样', ok, why);

    // applyProBacks 不碰 face / color，红块、空位不动，其余每一枚反面 = 下一色
    const cyc = m.proCycle(6, 1);
    const grid = [
      [{ color: 0, dotColor: 3, face: 'flavor' }, { color: 1, dotColor: 4, face: 'flavor' }, null],
      [{ color: -1, dotColor: -1, face: 'flavor' }, { color: 5, dotColor: 2, face: 'dot' }, { color: 2, dotColor: 2, face: 'flavor' }],
    ];
    m.applyProBacks(grid, cyc);
    const flat = grid.flat();
    check('② applyProBacks：反面 = 下一色、红块和空位原样、不碰 face 和 color',
      flat[0].dotColor === 2 && flat[0].color === 0 && flat[0].face === 'flavor' &&
      flat[1].dotColor === 4 && flat[1].color === 1 &&
      flat[2] === null &&
      flat[3].dotColor === -1 && flat[3].color === -1 &&
      flat[4].dotColor === 0 && flat[4].color === 5 && flat[4].face === 'dot' &&
      flat[5].dotColor === 3,
      JSON.stringify(flat.map((t) => t && t.dotColor)));

    // 取一个数 → applyProBacks → 再取一个数，等于参考序列的第二个（改写不取随机数）
    m.seedRandom('check-pro');
    const ref1 = m.random();
    const ref2 = m.random();
    m.seedRandom('check-pro');
    const a = m.random();
    const big = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => ({ color: (r + c) % 6, dotColor: 0 })));
    m.applyProBacks(big, m.proCycle(6, 0));
    const b = m.random();
    m.clearSeed();
    check('② 改写夹在两次取数中间，第二个数和参考序列一样（一个随机数都没取）', a === ref1 && b === ref2, `${b} vs ${ref2}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await erosionChecks(check);
}

/** ⑨ ⑩ ⑪：打包 engine/erosion.ts 实跑。 */
async function erosionChecks(check) {
  const dir = mkdtempSync(join(tmpdir(), 'check-pro-ero-'));
  try {
    const out = join(dir, 'erosion.mjs');
    buildSync({ entryPoints: [new URL('../src/engine/erosion.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
    const E = await import(pathToFileURL(out).href);
    const sq = E.EROSION_TABLE.square;

    // ⑨ 冻结
    const e = E.createErosion(sq, false, 2);
    e.reset({ frozen: true });
    e.spend(999);
    const frozenLv = e.level();
    e.reset();
    e.spend(999);
    const normalLv = e.level();
    check('⑨ reset({ frozen: true }) 之后扣 999 段仍是 4 枚；reset() 回普通，扣 999 段降到 2 枚', frozenLv === 4 && normalLv === 2, `${frozenLv} / ${normalLv}`);
    const f = E.createErosion(sq, true, 2);
    f.reset();
    f.spend(999);
    check('⑨ 无限反转（构造时 frozen）reset() 不带参数照旧冻结', f.level() === 4, String(f.level()));

    // ⑩ 松级：4→3→2 各回 true，到 2 回 false、停在 2；段数环跟着新一级画（idx / left）
    const r = E.createErosion(sq, false, 2);
    r.reset({ frozen: true });
    const a1 = r.release();
    const s1 = { lv: r.level(), left: r.segLeft(), total: r.segTotal() };
    const a2 = r.release();
    const s2 = { lv: r.level(), total: r.segTotal() };
    const a3 = r.release();
    check('⑩ release()：4→3、3→2 各回 true，到 2 回 false、停在 2', a1 && a2 && !a3 && s1.lv === 3 && s2.lv === 2 && r.level() === 2,
      `${a1}/${a2}/${a3} · ${s1.lv}→${s2.lv}→${r.level()}`);
    check('⑩ 松到 3 枚：这一级段数从 0 记（不结转）、段数环按新一级的段数画', s1.left === 0 && s1.total === sq.seg[1], JSON.stringify(s1));
    check('⑩ 松到最低级：段数环收掉（segTotal 0）', s2.total === 0, JSON.stringify(s2));
    r.spend(999);
    check('⑩ 松完照旧冻结：再扣 999 段也不降', r.level() === 2, String(r.level()));
    // 老虎机：三段表、最低 1 枚（站长 10-30，同普通老虎机）
    const slot = E.createErosion(E.slotTableFor('square', 36, 6), false, 1);
    slot.reset({ frozen: true });
    const steps = [slot.release(), slot.release(), slot.release(), slot.release()];
    check('⑩ 老虎机：4→3→2→1 三次回 true、第四次回 false，到 1 枚记「到过 1 枚」', steps.join() === 'true,true,true,false' && slot.level() === 1 && slot.unlocked(),
      `${steps.join()} · ${slot.level()} · unlocked=${slot.unlocked()}`);

    // ⑪ Pro par
    const want = { square: 98, circle: 51, squareDiamond: 98, circleSeven: 156, circleHex: 98, triangleBig: 147 };
    const got = Object.fromEntries(Object.keys(want).map((id) => [id, E.proParOf(E.EROSION_TABLE[id].par)]));
    check('⑪ proParOf 六副：方块 98、小球 51、菱形方块 98、七色 156、六边圆球 98、六边三角 147',
      Object.keys(want).every((id) => got[id] === want[id]), JSON.stringify(got));
    check('⑪ PRO_PAR_FACTOR 是 1.5', E.PRO_PAR_FACTOR === 1.5);
    const bad = Object.keys(want).filter((id) => MS.BOARD_LIMITS[id]?.proPar !== got[id] || MS.BOARD_LIMITS[id]?.par !== E.EROSION_TABLE[id].par);
    check('⑪ 服务器手抄的 proPar（api/_maxscore.js 的 BOARD_LIMITS）六副逐位对上', bad.length === 0, bad.map((id) => `${id}: ${MS.BOARD_LIMITS[id]?.proPar} vs ${got[id]}`).join(' / '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * ⑫ 行为：假 DOM 里真开一局带教学条的方块（Pro 开着）——这一局不是 Pro 局；按《再来一局》数完 4-3-2-1，这一局是 Pro 局。
 * 认 Pro 局两样：.app--game 上的 data-pro-run、侵蚀冻结（扣 999 段仍 4 枚）。`mutate` 给尺子用。
 */
async function coachBehaviour(mutate) {
  const ROOT = new URL('..', import.meta.url).pathname;
  const sim = await makeSim(ROOT, { motion: false, mutate });
  sim.B.setPro(true);
  const g = sim.open('square', { coach: true, proAllowed: true });
  const view = () => {
    const app = g.refs.root.querySelector('.app--game');
    const tagged = app?.getAttribute('data-pro-run') === '1';
    g.ero.spend(999);
    return { tagged, level: g.ero.level() };
  };
  try {
    g.refs.buttons.start.click();
    sim.settle(500);
    const first = view();
    g.refs.buttons.restart.click();
    sim.settle(6000);
    const second = view();
    return { first, second, coach: !!g.hooks.coach };
  } finally {
    g.close();
    sim.B.setPro(false);
    sim.restoreConsole();
  }
}

function run(src, quiet) {
  let fail = 0;
  const failed = [];
  const check = (n, ok, extra = '') => {
    if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
    if (!ok) {
      fail++;
      failed.push(n);
    }
  };
  sourceChecks(src, check);
  return { fail, failed, check };
}

const base = sources();
const { fail: f0, check } = run(base, false);
let fail = f0;
const rt = { n: 0 };
await runtimeChecks((n, ok, extra) => {
  check(n, ok, extra);
  if (!ok) rt.n++;
});
fail += rt.n;

{
  const r = await coachBehaviour();
  const one = r.first.tagged === false && r.first.level === 2;
  const two = r.second.tagged === true && r.second.level === 4;
  check('⑫ 教学局（Pro 开着）照普通打：不挂 data-pro-run、图案照常降到 2 枚', r.coach && one, JSON.stringify(r.first));
  check('⑫ 教学局之后按《再来一局》、Pro 开着：这一局是 Pro 局（挂 data-pro-run、冻结在 4 枚）', two, JSON.stringify(r.second));
  if (!(r.coach && one && two)) fail++;
}

if (MUTANTS) {
  /*
   * 尺子（⑦）：只在内存里改源码，看对应那几条红不红。
   *   甲 方块的改写挪到发牌之前  → ③ 要红
   *   乙 方块去掉 deal?.pro 判断（每一局都改写） → ③ 要红
   *   丙 删掉 launchSeedGame 的 proAllowed: false → ④ 要红
   *   丁–辛（推14 Z-B13）：松级不问正面色块、普通最低级写成 1、老虎机最低级写成 EROSION_FLOOR → ⑩ 要红；
   *        去掉教学局那一条、或写成 !hooks.coach → ⑫ 要红（「庚」「辛」另在假 DOM 里真开两局，行为那一条也要红）
   */
  const mutants = [
    {
      name: '甲 改写挪到发牌之前',
      file: 'src/shapes/square.ts',
      edit: (s) => {
        const pro = /\n( *)if \(deal\?\.pro\) applyProBacks\([^\n]*\n/.exec(s)[0];
        const t = s.replace(pro, '\n');
        return t.replace(`        ${BOMB_DEAL}`, pro.slice(1) + `        ${BOMB_DEAL}`);
      },
      want: '③ [square] 改写排在发牌之后',
    },
    {
      name: '乙 去掉 deal?.pro 判断',
      file: 'src/shapes/square.ts',
      edit: (s) => s.replace('if (deal?.pro) applyProBacks(', 'applyProBacks('),
      want: '③ [square] resetBoard 收 deal',
    },
    {
      name: '丙 每日、代号那条不再显式 false',
      file: 'src/main.ts',
      edit: (s) => s.replace(', proAllowed: false }', ' }'),
      want: '④ launchSeedGame',
    },
    // 推14 Z-B13 的五个（⑩ ⑫）
    {
      name: '丁 松级不问「盘上还有正面色块」',
      file: 'src/engine/gameController.ts',
      edit: (s) => s.replace(/\n\s*&& \(hooks\.countRemainingTiles\?\.\(\)\.neverFlipped \?\? 0\) > 0/, ''),
      want: '⑩ relaxIfStuck 只在盘上还有正面色块时松',
    },
    {
      name: '戊 普通棋盘的最低级写成 1',
      file: 'src/engine/gameController.ts',
      edit: (s) => s.replace('erosion.level() > (hooks.slot ? 1 : EROSION_FLOOR)', 'erosion.level() > (hooks.slot ? 1 : 1)'),
      want: '⑩ relaxIfStuck 的最低级',
    },
    {
      name: '己 老虎机的最低级写成 EROSION_FLOOR',
      file: 'src/engine/gameController.ts',
      edit: (s) => s.replace('erosion.level() > (hooks.slot ? 1 : EROSION_FLOOR)', 'erosion.level() > (hooks.slot ? EROSION_FLOOR : EROSION_FLOOR)'),
      want: '⑩ relaxIfStuck 的最低级',
    },
    {
      name: '庚 去掉 !(hooks.coach && !coachDealt)',
      file: 'src/engine/gameController.ts',
      edit: (s) => s.replace(' && !(hooks.coach && !coachDealt)', ''),
      want: '⑫ runPro 那一句',
    },
    {
      name: '辛 写成 !hooks.coach（教学局之后的再来一局也不开 Pro）',
      file: 'src/engine/gameController.ts',
      edit: (s) => s.replace('!(hooks.coach && !coachDealt)', '!hooks.coach'),
      want: '⑫ runPro 那一句',
    },
  ];
  console.log('\n—— 尺子 ——');
  for (const mu of mutants) {
    const src = { ...base, [mu.file]: mu.edit(base[mu.file]) };
    const changed = src[mu.file] !== base[mu.file];
    const r = run(src, true);
    const hit = r.failed.some((n) => n.startsWith(mu.want));
    check(`⑦ 尺子「${mu.name}」：${mu.want} 那一条红了`, changed && hit, changed ? `红了 ${r.fail} 条：${r.failed.join(' / ')}` : '没改到源码');
    if (!(changed && hit)) fail++;
  }
  // ⑫ 的行为那一条自己也要拦得住「辛」：源码那一句换掉了，真开两局，再来一局那一局不是 Pro 局。
  {
    const r = await coachBehaviour((rel, src) => (rel === 'src/engine/gameController.ts' ? src.replace('!(hooks.coach && !coachDealt)', '!hooks.coach') : src));
    const caught = !(r.second.tagged === true && r.second.level === 4);
    check('⑦ 尺子「辛」（行为）：教学局之后的《再来一局》不再是 Pro 局，⑫ 的行为断言红了', caught, JSON.stringify(r.second));
    if (!caught) fail++;
  }
  // 「庚」的行为：教学局自己也开了 Pro。
  {
    const r = await coachBehaviour((rel, src) => (rel === 'src/engine/gameController.ts' ? src.replace(' && !(hooks.coach && !coachDealt)', '') : src));
    const caught = !(r.first.tagged === false && r.first.level === 2);
    check('⑦ 尺子「庚」（行为）：教学局开了 Pro，⑫ 的行为断言红了', caught, JSON.stringify(r.first));
    if (!caught) fail++;
  }
}

console.log(fail ? `\n${fail} 条没过` : '\n全过');
process.exit(fail ? 1 : 0);
