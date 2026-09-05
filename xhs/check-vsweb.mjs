/**
 * 逐屏对着网页版核内容——这一版和 play-slides.com 上那五个玩法长得一样吗？
 *
 *   npm run build && npm run build:xhs && node xhs/preview.mjs
 *   node xhs/check-vsweb.mjs            # 全部
 *   node xhs/check-vsweb.mjs 老虎机     # 只跑一屏
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这一台
 *
 * 玩家给这一版定了两条：分开保存，和「对于选择出来的玩法完全复刻一样的内
 * 容」。第一条是构建时就保证的（这一版一个网络请求都没有，存档在小红书自
 * 己的 WebView 里）；第二条得量。
 *
 * check-oldcss.mjs 比的是「同一个包，降级前后一样吗」——那是这一版跟自己
 * 比。这一台比的是「这一版跟网页版一样吗」：同一个玩法，两边各开一局，把
 * 看得见的东西抓下来对。
 *
 * 抓什么：
 *   · 得分图案（.pattern-hint 里那几枚 SVG）——玩家点名要核的
 *   · 三个读数的名字（得分 / 有效得分率 / 时间）
 *   · 底下两颗键的图标和读屏名
 *   · 标题、副标题、开局页、暂停面板、结算页上的字
 *   · 棋盘的格数
 *
 * 不抓什么：分数、时间、随机发牌——两边各转各的骰子，比这些只会比出噪音。
 * 所有数字统一换成 #，字里的空白统一压平。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 网页版怎么跑起来
 *
 * dist/ 是 type=module 的产物，file:// 下模块脚本会被 CORS 拦掉，所以起一个
 * 十行的静态服务器。/api/* 一律给 404：这一台是离线比对，网页版碰不到服务
 * 器时本来就该自己站得住。localStorage 先填三样——语言（省掉开场那一屏）、
 * 三族教学看过了（省掉自动弹的教学）、以及一张 channel:'code' 的天才票
 * （老虎机和无限反转在网页版上是锁着的，不开锁就走不到那一局；这一版全部
 * 免费，锁本身不在比对范围里）。
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const XHS_PAGE = pathToFileURL(join(here, 'preview.html')).href;

let fails = 0;
const say = (ok, text, extra = '') => {
  if (!ok) fails++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (extra ? '  ' + extra : ''));
};
const note = (text) => console.log('  ····  ' + text);

// ---- 网页版的静态服务器 -----------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveDist() {
  const root = join(repo, 'dist');
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error('dist/ 里没有 index.html——先跑一次 npm run build');
  }
  const server = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    // 接口一律不通：这一台是离线比对。网页版遇到 404 该自己站得住。
    if (path.startsWith('/api/')) {
      res.writeHead(404).end('{}');
      return;
    }
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// ---- 抓指纹（在页面里跑） ---------------------------------------------------

/**
 * 一屏的指纹。分数、时间、随机发牌两边不可能一样，所以数字统统换成 #；
 * 空白压平；SVG 只留形状本身（去掉 id、style、宽高这些跟内容无关的）。
 */
const SNAP = (spec) => {
  const flat = (t) =>
    String(t || '')
      .replace(/\s+/g, ' ')
      .replace(/\d+/g, '#')
      .trim();

  /** SVG 只比形状：把随机 id、内联样式、尺寸都抹掉，剩下的路径顺序就是它。 */
  const svgSig = (el) => {
    const c = el.cloneNode(true);
    const strip = (n) => {
      if (n.nodeType !== 1) return;
      for (const a of [].slice.call(n.attributes)) {
        if (/^(id|style|class|aria-|data-|width|height)/.test(a.name)) n.removeAttribute(a.name);
      }
      for (const k of [].slice.call(n.childNodes)) strip(k);
    };
    strip(c);
    return c.outerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  };

  const out = {};
  for (const key of Object.keys(spec)) {
    const { sel, kind, within } = spec[key];
    const scope = within ? document.querySelector(within) : document;
    if (!scope) {
      out[key] = null;
      continue;
    }
    const nodes = [].slice.call(scope.querySelectorAll(sel));
    const live = nodes.filter((e) => {
      if (e.hidden) return false;
      const cs = getComputedStyle(e);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    if (kind === 'text') out[key] = live.map((e) => flat(e.textContent)).filter(Boolean);
    else if (kind === 'svg') out[key] = live.map(svgSig);
    else if (kind === 'label')
      out[key] = live.map((e) => flat(e.getAttribute('aria-label') || e.textContent));
    else if (kind === 'count') out[key] = nodes.length;
    else if (kind === 'class')
      out[key] = live.map((e) => e.tagName.toLowerCase() + '.' + e.className.toString().trim().split(/\s+/).join('.'));
  }
  return out;
};

/**
 * 两份指纹比一比。
 *
 * 有几处两边**本来就该不一样**（这一版少一个三角、暂停面板多一颗《怎么
 * 玩》……）。那几处由每一屏自己的 accept 认领：认领了的记成「说好的差别」，
 * 不算没过；没认领的才是没过。
 *
 * 这么分是有用的——说好的差别写在代码里、每次都跑，哪天网页版改了别处、
 * 或者这一版不小心多漏了一样，它立刻从「说好的」里掉出来变成没过。
 */
function diff(a, b, accept) {
  const bad = [];
  const known = [];
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    const why = accept ? accept(k, a[k], b[k]) : null;
    (why ? known : bad).push({ k, web: a[k], xhs: b[k], why });
  }
  return { bad, known };
}

const show = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 300 ? s.slice(0, 300) + ' …' : s;
};

// ---- 走到棋盘（两边共用的最后一步） -----------------------------------------

async function pressStart(p) {
  const start = await p.$('#startBtn');
  if (start) await p.$eval('#startBtn', (e) => e.click());
  await p.waitForFunction(
    () => document.querySelectorAll('#boardWrap .tile, #boardWrap .ball').length > 0,
    { timeout: 30000 },
  );
  await p.waitForTimeout(1200);
}

/**
 * 真拖八下再按《完成》——结算页只有这样才到得了。
 * 拖出来什么分不重要（分数不参与比对），要的是一局真的走到了头。
 */
async function playAndFinish(p) {
  const box = await p.$eval('.board', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (let i = 0; i < 8; i++) {
    const row = 0.12 + (i % 6) * 0.15;
    await p.mouse.move(box.x + box.w * 0.5, box.y + box.h * row);
    await p.mouse.down();
    await p.mouse.move(box.x + box.w * 0.5 + (i % 2 ? 62 : -62), box.y + box.h * row, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(260);
  }
  // 有可能这一局已经自己结束了（结算页盖上来，#finishBtn 就点不着了）。
  // 那是一局正常走完，不是毛病——尤其老虎机：只认转出来的那两个图案，瞎拖
  // 十下很容易把场面拖到「再也凑不出来」。
  const ended = await p.$eval('#endOverlay', (e) => e.classList.contains('show')).catch(() => false);
  if (!ended) await p.click('#finishBtn');
  await p.waitForTimeout(2800);
}

/** 点一颗名字对得上的按钮。找不到就报出来，别静静地走错路。 */
async function tapByText(p, sel, re, what) {
  const els = await p.$$(sel);
  for (const el of els) {
    const t = ((await el.getAttribute('aria-label')) || (await el.textContent()) || '').trim();
    if (re.test(t)) {
      await el.click();
      return true;
    }
  }
  throw new Error(`找不到${what}（${sel} 里没有匹配 ${re}）`);
}

// ---- 各屏 -------------------------------------------------------------------
//
// 每一屏两条路：web 那条从网页版主菜单走，xhs 那条从这一版主菜单走；
// snap 是要抓的东西，两边用同一份。

/** 五个玩法在这一版主菜单上的次序（menu.ts 的 CARDS）。 */
const XHS_CARD = { square: 0, circle: 1, bomb: 2, slot: 3, flip: 4 };

const tapXhsCard = (p, mode) =>
  p.$$eval('.home-icon-btn', (e, i) => e[i].click(), XHS_CARD[mode]);

/** 网页版主菜单上按小字找卡。小字两边同源（menuTags.ts），所以找得准。 */
async function tapWebTag(p, text) {
  const ok = await p.$$eval(
    '.home-icon-btn, .home-bomb-card, .home-bomb-mini',
    (els, t) => {
      for (const e of els) {
        const tag = e.querySelector('.home-icon-tag');
        if (tag && tag.textContent.trim() === t) {
          e.click();
          return true;
        }
      }
      return false;
    },
    text,
  );
  if (!ok) throw new Error(`网页版主菜单上没有《${text}》这张卡`);
  await p.waitForTimeout(900);
}

/** 局中那一屏要抓的东西。得分图案是重点。 */
const GAME_SNAP = {
  标题: { sel: '.app--game > h1', kind: 'text' },
  副标题: { sel: '.app--game > .tag-line', kind: 'text' },
  读数名: { sel: '.app--game .hud-cell .k', kind: 'text' },
  得分图案: { sel: '.pattern-hint--a .ph-part svg', kind: 'svg' },
  得分图案枚数: { sel: '.pattern-hint--a .ph-part svg', kind: 'count' },
  底排按键: { sel: '.controls .icon-btn', kind: 'label' },
  底排按键图标: { sel: '.controls .icon-btn svg', kind: 'svg' },
  棋子数: { sel: '#boardWrap .tile, #boardWrap .ball', kind: 'count' },
  棋盘玩法: { sel: '.app--game', kind: 'class' },
};

/** 开局页（倒数那一屏）。 */
const START_SNAP = {
  开局图标: { sel: '.start-mark svg', kind: 'svg' },
  开局按键: { sel: '.start-actions .icon-btn', kind: 'label' },
  开局文字: { sel: '.start-stage .start-note, .start-stage h2, .start-stage p', kind: 'text' },
};

/** 挑形状那一屏（炸弹 / 老虎机 / 无限反转都有）。 */
const PICK_SNAP = {
  可挑的形状: { sel: '.slot-pick-opt', kind: 'label' },
  形状图标: { sel: '.slot-pick-opt > svg', kind: 'svg' },
};

const SCREENS = [
  {
    name: '主菜单：五张卡的图与小字',
    async web(p) {},
    async xhs(p) {},
    // 网页版主菜单上有十三张卡，这一版只留五张。比的是「这五张在两边长得一
    // 样吗」，所以按小字配对，一张一张比图。
    custom: async (webPage, xhsPage) => {
      const grab = (p) =>
        p.evaluate(() => {
          const out = {};
          const els = document.querySelectorAll('.home-icon-btn, .home-bomb-card, .home-bomb-mini');
          for (const e of els) {
            const tag = e.querySelector('.home-icon-tag');
            if (!tag) continue;
            const art = e.querySelector('.home-icon-art');
            const svg = art && art.querySelector('svg');
            const c = svg ? svg.cloneNode(true) : null;
            if (c) {
              const strip = (n) => {
                if (n.nodeType !== 1) return;
                for (const a of [].slice.call(n.attributes)) {
                  if (/^(id|style|class|aria-|data-|width|height)/.test(a.name)) n.removeAttribute(a.name);
                }
                for (const k of [].slice.call(n.childNodes)) strip(k);
              };
              strip(c);
            }
            out[tag.textContent.trim()] = {
              读屏名: (e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
              图: c ? c.outerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim() : '(不是单张 SVG)',
            };
          }
          return out;
        });
      const web = await grab(webPage);
      const xhs = await grab(xhsPage);
      for (const tag of Object.keys(xhs)) {
        if (!web[tag]) {
          say(false, `《${tag}》这张卡在网页版主菜单上找不到`);
          continue;
        }
        // 炸弹那张是说好的差别：网页版那张卡画的是**整块炸弹板块**（基础 /
        // 90 秒 / 进阶三档的缩略图），因为点开它是要挑档次的。这一版只有基
        // 础一档，摆一张三档的缩略图是在说假话。所以换成网页版自己的「这一
        // 局是炸弹局」标志（homeIcons.ts 的 ICON_BOMB_BADGE，网页版把它摆在
        // 炸弹局的开局页和战绩图上）——底下那一屏专门证明这两张是同一张。
        if (tag === '炸弹' && web[tag].图 !== xhs[tag].图) {
          note('《炸弹》：说好的差别——网页版那张卡是三档缩略图，这一版只有基础一档，改用网页版的炸弹局标志（见下一屏）');
        } else {
          say(web[tag].图 === xhs[tag].图, `《${tag}》的图和网页版一样`,
            web[tag].图 === xhs[tag].图 ? '' : `网页 ${web[tag].图.slice(0, 90)} … ／ 这一版 ${xhs[tag].图.slice(0, 90)} …`);
        }
        // 读屏名（aria-label）两边不一样，是**故意留的**，不是漏的。
        //
        // 网页版念的是玩法的正式名字（「方块」「圆球」「基础炸弹」「老虎机
        // 模式」），卡底下那行小字另有一套（「经典方块」……）；这一版两处
        // 都念小字。
        //
        // 让它们一致，是因为这一版一屏只有五张卡，看得见的字和听得见的字对
        // 不上没有好处。「基础炸弹」那一个还会主动误导——「基础」是相对于
        // 90 秒和进阶说的，那两档这一版没有。
        //
        // 看得见的那一行（.home-icon-tag）仍旧和网页版逐字相同，走的是同一
        // 张表（menuTags.ts）。念出来的这一层不影响任何人看到的画面。
        if (web[tag].读屏名 !== xhs[tag].读屏名) {
          note(`《${tag}》读屏名：网页念「${web[tag].读屏名}」，这一版念「${xhs[tag].读屏名}」（跟着看得见的小字走，故意的）`);
        }
      }
      note(`这一版摆了 ${Object.keys(xhs).length} 张：${Object.keys(xhs).join('、')}`);
    },
  },

  {
    name: '基础方块 · 局中',
    async web(p) {
      await tapWebTag(p, '经典方块');
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'square');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    snap: GAME_SNAP,
  },
  {
    name: '基础方块 · 开局页',
    async web(p) {
      await tapWebTag(p, '经典方块');
      await p.waitForTimeout(600);
    },
    async xhs(p) {
      await tapXhsCard(p, 'square');
      await p.waitForTimeout(1500);
    },
    snap: START_SNAP,
  },
  {
    name: '基础小球 · 局中',
    async web(p) {
      await tapWebTag(p, '经典小球');
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'circle');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    snap: GAME_SNAP,
  },
  {
    name: '炸弹（方块）· 局中',
    async web(p) {
      await tapWebTag(p, '炸弹');
      await p.waitForTimeout(900);
      // 弹出来那块面板的第一排是「基础」，第一颗是方块。
      await p.$$eval('.center-pick .bomb-row .bomb-chip, .bomb-panel .bomb-row .bomb-chip', (e) => e[0].click());
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'bomb');
      await p.waitForTimeout(900);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    snap: GAME_SNAP,
  },
  {
    name: '老虎机（方块）· 转前挑形状',
    async web(p) {
      await tapWebTag(p, '老虎机');
      await p.waitForTimeout(1200);
    },
    async xhs(p) {
      await tapXhsCard(p, 'slot');
      await p.waitForTimeout(1200);
    },
    snap: PICK_SNAP,
    // 这一版只有方块和小球，网页版三个。差的那一颗必须**正好是三角**，
    // 前两颗必须一模一样——差别只许差在这一处，不许差在别处。
    accept: (k, web, xhs) => {
      if (k === '可挑的形状' && JSON.stringify(web) === '["方块","圆球","三角"]' && JSON.stringify(xhs) === '["方块","圆球"]')
        return '这一版摘掉了三角（xhs/src/main.ts 的 showSlot），前两颗一字不差';
      if (k === '形状图标' && web.length === 3 && xhs.length === 2 && web[0] === xhs[0] && web[1] === xhs[1])
        return '同上：少的是第三张（三角），留下的两张图和网页版逐字节相同';
      return null;
    },
  },
  {
    name: '老虎机（方块）· 局中',
    async web(p) {
      await tapWebTag(p, '老虎机');
      await p.waitForTimeout(1200);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(9500);
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'slot');
      await p.waitForTimeout(1200);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(9500);
      await pressStart(p);
    },
    // 老虎机每局抽的图案是随机的，两边不可能抽到同一对——所以这一屏不比
    // 图案本身，比的是「抽出来几枚、摆在哪、别的部件一不一样」。
    snap: (() => {
      const s = { ...GAME_SNAP };
      delete s.得分图案;
      return s;
    })(),
    expect: '得分图案本身是随机抽的，两边不会一样；这里只核枚数和别的部件',
  },
  {
    name: '无限反转（方块）· 开局页',
    async web(p) {
      await tapWebTag(p, '无限反转');
      await p.waitForTimeout(1200);
    },
    async xhs(p) {
      await tapXhsCard(p, 'flip');
      await p.waitForTimeout(1200);
    },
    snap: { ...PICK_SNAP, 说明: { sel: '.flip-note, .start-note, .slot-pick-area p', kind: 'text' } },
  },
  {
    name: '无限反转（方块）· 局中',
    async web(p) {
      await tapWebTag(p, '无限反转');
      await p.waitForTimeout(1200);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'flip');
      await p.waitForTimeout(1200);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    snap: { ...GAME_SNAP, 倒计时: { sel: '#hud-time', kind: 'text' } },
  },
  {
    name: '暂停面板',
    async web(p) {
      await tapWebTag(p, '经典方块');
      await pressStart(p);
      await p.click('#stopBtn');
      await p.waitForTimeout(900);
    },
    async xhs(p) {
      await tapXhsCard(p, 'square');
      await p.waitForTimeout(900);
      await pressStart(p);
      await p.click('#stopBtn');
      await p.waitForTimeout(900);
    },
    snap: {
      面板文字: { sel: '#pauseOverlay .modal h2, #pauseOverlay .modal p', kind: 'text' },
      面板按键: { sel: '#pauseOverlay .modal button', kind: 'label' },
    },
    // 多的必须正好是《怎么玩》，而且必须插在《继续》前面——别的键一颗不许多、
    // 一颗不许少，顺序也不许变。
    accept: (k, web, xhs) => {
      if (k !== '面板按键') return null;
      const without = xhs.filter((t) => t !== '怎么玩');
      const at = xhs.indexOf('怎么玩');
      if (JSON.stringify(without) === JSON.stringify(web) && at === xhs.indexOf('继续') - 1)
        return '这一版在《继续》上面多插了一颗《怎么玩》（main.ts 的 enhancePauseTutorial），别的键一字不差';
      return null;
    },
  },
  {
    // 上一屏留的尾巴：这一版主菜单上那张炸弹卡，用的到底是不是网页版自己的
    // 炸弹标志？把网页版炸弹局的开局页调出来，拿那上面的标志跟这一版的卡对。
    // 对上了，「换了一张图」就不是「另画了一张」，而是「换成了网页版画给这
    // 件事的那一张」。
    name: '炸弹卡的图 = 网页版炸弹局的标志',
    custom: async (webPage, xhsPage) => {
      await tapWebTag(webPage, '炸弹');
      await webPage.waitForTimeout(900);
      await webPage.$$eval('.center-pick .bomb-row .bomb-chip, .bomb-panel .bomb-row .bomb-chip', (e) => e[0].click());
      await webPage.waitForTimeout(1400);
      // 网页版炸弹局的开局页上有两张标志：玩法自己的（方块）和炸弹的。
      // 取全部，看这一版的卡在不在里面。
      const webMarks = await webPage.evaluate(() => {
        const strip = (n) => {
          if (n.nodeType !== 1) return;
          for (const a of [].slice.call(n.attributes)) {
            if (/^(id|style|class|aria-|data-|width|height)/.test(a.name)) n.removeAttribute(a.name);
          }
          for (const k of [].slice.call(n.childNodes)) strip(k);
        };
        return [].slice.call(document.querySelectorAll('.start-mark svg')).map((e) => {
          const c = e.cloneNode(true);
          strip(c);
          return c.outerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
        });
      });
      // 炸弹是这一版主菜单上的第三张（menu.ts 的 CARDS）。卡分散在几个
      // .home-row 里，所以按全局次序取，不能用 nth-of-type。
      const found = (c) => !!c && webMarks.indexOf(c) >= 0;
      const card = await xhsPage.evaluate(() => {
        const btn = document.querySelectorAll('.home-icon-btn')[2];
        const el = btn && btn.querySelector('.home-icon-art svg');
        if (!el) return null;
        const c = el.cloneNode(true);
        const strip = (n) => {
          if (n.nodeType !== 1) return;
          for (const a of [].slice.call(n.attributes)) {
            if (/^(id|style|class|aria-|data-|width|height)/.test(a.name)) n.removeAttribute(a.name);
          }
          for (const k of [].slice.call(n.childNodes)) strip(k);
        };
        strip(c);
        return c.outerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
      });
      say(
        found(card),
        '这一版炸弹卡上那张图，就是网页版炸弹局开局页上的那张标志',
        found(card)
          ? ''
          : card
            ? webMarks.length
              ? `网页版那一屏有 ${webMarks.length} 张标志，没有一张对上`
              : '网页版那一屏一张标志也没抓到'
            : '这一版的卡上没抓到 SVG',
      );
    },
  },

  {
    name: '炸弹（方块）· 开局页',
    async web(p) {
      await tapWebTag(p, '炸弹');
      await p.waitForTimeout(900);
      await p.$$eval('.center-pick .bomb-row .bomb-chip, .bomb-panel .bomb-row .bomb-chip', (e) => e[0].click());
      await p.waitForTimeout(1400);
    },
    async xhs(p) {
      await tapXhsCard(p, 'bomb');
      await p.waitForTimeout(900);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(1400);
    },
    snap: START_SNAP,
  },

  {
    name: '结算页',
    async web(p) {
      await tapWebTag(p, '经典方块');
      await pressStart(p);
      await playAndFinish(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'square');
      await p.waitForTimeout(900);
      await pressStart(p);
      await playAndFinish(p);
    },
    snap: {
      结算标题: { sel: '.overlay--end .modal h2', kind: 'text' },
      结算明细名: { sel: '.overlay--end .end-breakdown .eb-k, .overlay--end .end-breakdown dt', kind: 'text' },
      结算文字: { sel: '.overlay--end .modal p', kind: 'text' },
      结算按键: { sel: '.overlay--end .btn-row button', kind: 'label' },
    },
    // 网页版结算页上那颗《再来一局》/《回主菜单》两边一样；如果哪天不一样了
    // 要立刻知道，所以这里不给任何 accept。
  },

  {
    name: '成绩栏（这一版的成绩页 vs 网页版的记录与排名）',
    async web(p) {
      await tapWebTag(p, '经典方块');
      await pressStart(p);
      await playAndFinish(p);
      await tapByText(p, '.overlay--end .btn-row button', /菜单|返回|主页/, '结算页上回主菜单那颗');
      await p.waitForTimeout(1600);
      // 底排右半边是《记录与排名》。
      await p.$$eval('.home-nav-btn', (e) => e[e.length - 1].click());
      await p.waitForTimeout(1600);
    },
    async xhs(p) {
      await tapXhsCard(p, 'square');
      await p.waitForTimeout(900);
      await pressStart(p);
      await playAndFinish(p);
      await tapByText(p, '.overlay--end .btn-row button', /菜单|返回|主页/, '结算页上回主菜单那颗');
      await p.waitForTimeout(1600);
      await p.click('#xhsProfile');
      await p.waitForTimeout(1400);
    },
    snap: {
      累计得分标题: { sel: '.total-card .total-card-title', kind: 'text' },
      记录行结构: { sel: '.records-row > span', kind: 'class' },
      记录行文字: { sel: '.records-row .records-row-name', kind: 'text' },
      玩法小图: { sel: '.records-row .records-row-glyph svg', kind: 'svg' },
    },
    expect: '这一版把《个人主页》和《记录与排名》并成一屏（玩家定的），所以只比成绩那一块',
  },

  {
    // 横屏的得分图案是劈成两半贴在棋盘左右的（gameShell.ts 的 pattern-hint--a
    // / --b）。竖屏那一遍量不到这件事，所以这里单独走一趟横屏：两半各有几枚、
    // 是不是同样那几枚。
    name: '基础方块 · 局中（横屏）',
    view: 'land',
    async web(p) {
      await tapWebTag(p, '经典方块');
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'square');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    snap: {
      ...GAME_SNAP,
      左半图案: { sel: '.pattern-hint--a .ph-part:not(.ph-part--tail) svg', kind: 'svg' },
      右半图案: { sel: '.pattern-hint--b svg', kind: 'svg' },
    },
  },
  {
    name: '无限反转（方块）· 局中（横屏）',
    view: 'land',
    async web(p) {
      await tapWebTag(p, '无限反转');
      await p.waitForTimeout(1200);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    async xhs(p) {
      await tapXhsCard(p, 'flip');
      await p.waitForTimeout(1200);
      await p.click('[data-family="square"]');
      await p.waitForTimeout(900);
      await pressStart(p);
    },
    snap: { ...GAME_SNAP, 倒计时: { sel: '#hud-time', kind: 'text' } },
  },

  {
    name: '六条规则',
    async web(p) {
      // 网页版这六条在教学挑选页下半截。走个人主页 → 教学。
      await p.evaluate(() => {
        const b = document.querySelector('.home-nav-btn');
        if (b) b.click();
      });
      await p.waitForTimeout(1200);
      await tapByText(p, 'button', /怎么玩|教学|规则|如何/, '教学入口');
      await p.waitForTimeout(1400);
    },
    async xhs(p) {
      await p.click('#xhsProfile');
      await p.waitForTimeout(1000);
      await p.click('.xhs-how');
      await p.waitForTimeout(900);
    },
    snap: {
      规则文字: { sel: '.tut-rule .tut-rule-text', kind: 'text' },
      规则序号: { sel: '.tut-rule .tut-rule-num', kind: 'text' },
      规则配图: { sel: '.tut-rule .tut-rule-art svg', kind: 'svg' },
    },
    // 第 1 条那幅图，网页版摆的是方块、小球、三角各一正一反，这一版摆两样
    // ——三角这一版整个不做（玩家定的：详细教学里凡是三角的字和图都去掉），
    // 摆一个玩不到的形状是在说假话。
    //
    // 认领的口径卡得很死：把网页版那份里**所有三角**摘掉之后，必须和这一版
    // 一个字节不差。所以少了别的、多了别的、留下的哪一张改了样子，这一条都
    // 认不了，照样报红。
    accept: (k, web, xhs) => {
      if (k !== '规则配图') return null;
      // 三角那张图的轮廓（src/ui/ruleArt.ts 的 TRI_OUT，圆角三角）。正面反面
      // 都是这条路径打头，认它就够了。
      const TRI = 'M40.8 23.2 Q50 6 59.2 23.2';
      const cut = web.filter((s) => s.indexOf(TRI) < 0);
      if (JSON.stringify(cut) === JSON.stringify(xhs))
        return `这一版摘掉了三角（xhs/src/tutorial.ts 的 buildRuleArt({ triangle: false })），少的正好是那 ${web.length - xhs.length} 张三角图，其余逐字节相同`;
      return null;
    },
  },
];

// ---- 跑 ---------------------------------------------------------------------

const PRESET = `
try {
  localStorage.setItem('slides_lang', 'zhHans');
  localStorage.setItem('slides_tutorial_seen', '1');
  localStorage.setItem('slides_tutorial_seen_circle', '1');
  localStorage.setItem('slides_tutorial_seen_triangle', '1');
  // 这一版第一次点开方块 / 小球会先放一段分镜动画，先填上「看过了」，
  // 否则走不到棋盘。那两段本身另有专门的脚本测（check-story）。
  localStorage.setItem('slides.xhs.story.square', '1');
  localStorage.setItem('slides.xhs.story.circle', '1');
  // 网页版把老虎机和无限反转锁在天才票后面，不开锁走不到那一局。这一版全部
  // 免费，锁不在比对范围里，所以这里直接发一张。channel:'code' 是内部码那条
  // 路，subscription.ts 的 read() 对它免检渠道。
  localStorage.setItem('slides_genius', JSON.stringify({ active: true, channel: 'code' }));
} catch (e) {}
`;

async function openPage(browser, url, view) {
  const ctx = await browser.newContext({
    viewport: { width: view.w, height: view.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  await ctx.addInitScript(PRESET);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(url);
  await p.waitForSelector('.home-icon-btn', { timeout: 40000 });
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}

const only = process.argv[2];
const list = only ? SCREENS.filter((s) => s.name.indexOf(only) >= 0) : SCREENS;
if (!list.length) {
  console.log('没有这一屏：' + only);
  process.exit(1);
}

const server = await serveDist();
const WEB_PAGE = `http://127.0.0.1:${server.address().port}/`;
console.log('网页版：' + WEB_PAGE);
console.log('这一版：' + XHS_PAGE);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const PORTRAIT = { name: '竖屏 390×844', w: 390, h: 844 };
const LANDSCAPE = { name: '横屏 844×390', w: 844, h: 390 };

for (const screen of list) {
  console.log('\n---- ' + screen.name + ' ----');
  if (screen.expect) note(screen.expect);
  const view = screen.view === 'land' ? LANDSCAPE : PORTRAIT;
  const web = await openPage(browser, WEB_PAGE, view);
  const xhs = await openPage(browser, XHS_PAGE, view);
  try {
    if (screen.custom) {
      await screen.custom(web.p, xhs.p);
    } else {
      await screen.web(web.p);
      await screen.xhs(xhs.p);
      const a = await web.p.evaluate(SNAP, screen.snap);
      const b = await xhs.p.evaluate(SNAP, screen.snap);
      const { bad, known } = diff(a, b, screen.accept);
      say(
        bad.length === 0,
        `${screen.name}：内容和网页版一致（核了 ${Object.keys(screen.snap).length} 项${
          known.length ? `，另有 ${known.length} 处说好的差别` : ''
        }）`,
      );
      for (const d of known) console.log(`           ○ ${d.k}：${d.why}`);
      for (const d of bad) {
        console.log(`           ✗ ${d.k}`);
        console.log(`             网页版　 ${show(d.web)}`);
        console.log(`             这一版　 ${show(d.xhs)}`);
      }
    }
  } catch (e) {
    say(false, `${screen.name}：走不到这一屏`, String(e).split('\n')[0]);
  }
  if (xhs.errs.length) say(false, '这一版有报错', xhs.errs.slice(0, 2).join(' | '));
  await web.ctx.close();
  await xhs.ctx.close();
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} 项没过` : '\n全部通过');
process.exit(fails ? 1 : 0);
