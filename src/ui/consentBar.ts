/**
 * 主菜单上那张 Google Analytics 同意条（10-11 方案 A-14，样式「② 奶油磨砂卡」）。
 *
 * ── 什么时候出现 ─────────────────────────────────────────────
 *
 * 只在网页端的**主菜单**上，而且四样同时成立：这一份构建配了 GA（VITE_GA_ID）、跑在线上的网址上、
 * 本机还没有答复（或者答复过期了，见 engine/consent.ts）、屋主不是在替整屋挑玩法（pickingForRoom）。
 * 对局、倒数、小屋那几屏上它根本不存在——它长在主菜单那块招牌的盒子里（`.home-page .home-head`），
 * 换屏就是换掉那一棵 DOM，和「有新版本」那一行（ui/newVersionPill.ts）同一个办法。任何弹窗开着
 * 的时候藏起来（style.css 的 `.consent-bar` 那段：`:has()` 认得出就用它，认不出就用这儿盖在
 * `<html>` 上的 `has-overlay`）。
 *
 * 小红书那一版（统计模块是空替身，gaConsentApplies 恒为 false）和 iOS 外壳（isLiveSite 为假）
 * 都不显示。
 *
 * ── 规矩（CNIL 2020-09-29 的指引） ───────────────────────────────
 *
 *   · 「接受」和「拒绝」**一样大、一样样子、一样好按**，不分主次；
 *   · 不点也能玩：它不挡任何东西，GA 不加载，下一次回到主菜单再出现；
 *   · 点了哪一颗都当场消失，答复记在本机（engine/consent.ts）。
 *
 * ── 摆在哪儿（不许压住任何一张玩法卡、招牌、底排） ───────────────────
 *
 *   · 手机（窄版，鱼眼轴那一路）：招牌下沿往下 12px，左右各 16px。招牌那一层本来就盖在轴上（z 60），
 *     卡片从它底下滑过去，这张条跟着招牌住，所以是同一个规矩：滑过去的卡从它底下走，它不新占走
 *     「静止时」任何一块点得着的地方；
 *   · 电脑（≥1000 宽）：右上角，离右边、上边各 24px，宽 360px；
 *   · 量出来还是压到了（法语 360×740、320×568、电脑 1000×700 这几档）：先换短一句的紧凑版；紧凑版
 *     还压到，就让主菜单的内容整体往下让（`--consent-room`，style.css 里鱼眼轴的中线和宽版网格都
 *     认它），条一走就复原。
 */
import { STRINGS, type Lang } from '../i18n';
import { legalDoc } from '../legal';
import { consentChoice } from '../engine/consent';
import { acceptAnalytics, declineAnalytics, gaConsentApplies } from '../engine/analytics';

const ID = 'consentBar';
const CLS = 'consent-bar';
/** 住在主菜单招牌那个盒子里。前缀 `.home-page` 的理由见 newVersionPill.ts 的 HOST。 */
const HOST = '.home-page .home-head';
/** 条和招牌、卡片之间至少留多少。 */
const GAP = 12;

interface Hooks {
  /** 点链接：打开隐私政策那扇窗（应用里那一扇，顶上有撤回的开关）。 */
  openPrivacy: () => void;
  /** 此刻不该出现（屋主正在替整屋挑玩法）。 */
  suppressed: () => boolean;
}

let lang: Lang = 'zhHans';
let hooks: Hooks | null = null;
let fitRaf = 0;
/** 盯着招牌那块玻璃的高度：「有新版本」那一行长进去、换语言折了行，玻璃一长，条就得跟着往下挪。 */
let glassWatch: ResizeObserver | null = null;
/**
 * 上一次量出来的结果（紧凑没有、往下让了多少）。主菜单每次重画都是一棵新的 DOM，新的条要等两帧才量
 * 得了——这两帧里先照上一次的样子摆，不然 320 宽的屏上每回到一次主菜单，条就先闪成完整版、整条轴先
 * 弹回原处再往下让一下。量完以 fit 为准。
 */
let last = { compact: false, room: '' };

/** 这一刻该不该摆出来：构建配了 GA、线上、没答过（或过期）、不在替整屋挑玩法。 */
function wanted(): boolean {
  return !!hooks && gaConsentApplies() && consentChoice() === null && !hooks.suppressed();
}

function make(): HTMLElement {
  const el = document.createElement('section');
  el.id = ID;
  el.className = CLS;
  el.setAttribute('role', 'region');
  el.innerHTML = `
    <p class="consent-text"><span class="consent-say"></span> <a class="consent-link" href="/privacy"></a></p>
    <div class="consent-btns">
      <button type="button" class="consent-btn" data-v="granted"></button>
      <button type="button" class="consent-btn" data-v="denied"></button>
    </div>`;
  // 链接写真网址（/privacy 是 build-legal 出的静态页，新标签页、复制链接都对），平常点一下开应用
  // 里那扇窗——那一扇顶上有撤回的开关，静态页上没有。
  el.querySelector<HTMLAnchorElement>('.consent-link')!.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    hooks?.openPrivacy();
  });
  for (const btn of Array.from(el.querySelectorAll<HTMLButtonElement>('.consent-btn'))) {
    btn.addEventListener('click', () => {
      if (btn.dataset.v === 'granted') acceptAnalytics();
      else declineAnalytics();
      remove();
    });
  }
  return el;
}

/** 把字填成这一种语言、这一档（完整 / 紧凑）。 */
function paint(el: HTMLElement, compact: boolean): void {
  const s = STRINGS[lang];
  el.classList.toggle('consent-bar--compact', compact);
  el.setAttribute('aria-label', s.consentRegion);
  el.querySelector('.consent-say')!.textContent = compact ? s.consentShort : s.consentFull;
  // 链接用隐私政策自己的标题；紧凑版用短的那一个（只有法语不一样：« Confidentialité »）。
  el.querySelector('.consent-link')!.textContent = compact ? s.consentPrivacyShort : legalDoc(lang, 'privacy').title;
  const [yes, no] = Array.from(el.querySelectorAll<HTMLButtonElement>('.consent-btn'));
  yes.textContent = s.consentAccept;
  no.textContent = s.consentDecline;
}

function page(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.home-page');
}

function remove(): void {
  document.getElementById(ID)?.remove();
  glassWatch?.disconnect();
  glassWatch = null;
  const p = page();
  if (p) {
    p.style.removeProperty('--consent-room');
    p.classList.remove('home-page--consent');
  }
}

/**
 * 两个矩形之间（留出 gap 的余量）有没有交叠。
 *
 * 减掉 1px 的容差：招牌那块玻璃的下沿常常落在小数像素上（104.4），条的上沿是取整写进去的，差那零
 * 点几像素就会被算成「压到了」——第一版就这么红过：法语 390×844 上它把主菜单往下推了 735px。
 */
function hits(a: DOMRect, b: DOMRect, gap: number): boolean {
  const g = gap - 1;
  return a.left < b.right + g && b.left < a.right + g && a.top < b.bottom + g && b.top < a.bottom + g;
}

/**
 * 条底下那一带有几样东西要躲：玩法卡（看得见、点得着的那两块——图和卡底下那行小字）、两侧的点点、
 * 《我会玩》。这几样都跟着 `--consent-room` 往下走，所以压到了可以让。
 *
 * 招牌和底排不在这儿：一个在条上面、一个钉在屏幕底下，往下让一个也让不开（招牌那 12px 由 place
 * 摆出来，电脑那一档右上角离招牌二十多像素；三者不相交由门 check-consent 在六种尺寸上量）。
 *
 * 鱼眼轴上（竖屏手机）卡片只算**上沿在条的上沿之下**的：停在中间某一张的时候，它上面那几张本来就从
 * 招牌底下滑过去（招牌也盖着它们），那不是这张条压的，让也让不开——全轴往下挪，上面那几张照样在那一带。
 *
 * 宽版（电脑、手机横过来）没有鱼眼轴，卡片不从招牌底下滑过去，一张都不许压：手机横过来（844×390、
 * 812×375）时第一排两张卡的上沿（84）正好比条的上沿（85）高一个像素，照竖屏那条规矩不算，条就整块压在
 * 它们身上、还收走它们的点击（10-11 写「有新版本」那张卡时量出来的；原先门量的六种尺寸里没有横屏）。
 */
function obstacles(bar: DOMRect): DOMRect[] {
  const out: DOMRect[] = [];
  const vh = window.innerHeight;
  const wide = !!document.querySelector('.home-page--wide');
  for (const el of Array.from(
    document.querySelectorAll('.home-page .home-icon-art, .home-page .home-icon-tag, .home-page .axis-rail, .home-page .know-how-btn'),
  )) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= vh) continue;
    if (!wide && r.top < bar.top) continue;
    out.push(r);
  }
  return out;
}

/** 电脑那一档的宽（方案 A-14：右上角，宽 360）。 */
const DESK_W = 360;

/**
 * 手机上的 top：招牌那块玻璃的下沿往下 12px，量出来写进 `--consent-top`（相对 `.home-head`）。
 * 向上取整：宁可多半个像素，不要少——少了就不到 12px。
 * 电脑那一档在 style.css 里写死 top: 24px，这个变量在那儿不起作用。
 *
 * 电脑那一档（style.css 里是 position: fixed）另量一样：招牌是居中的，副标题一个字一个字打出来，法语那一句
 * 打完之后在 1000 宽上把招牌撑到右沿 617，而条的左沿在 616——压上去了（1000–1023 宽都离不出 12px）。右边那
 * 一截放不下「360 宽 + 离招牌 12」时条收窄一点（`--consent-w`，1000 宽的法语是 347），别的语言、宽一点的屏
 * 照旧 360。
 */
function place(el: HTMLElement): void {
  const head = el.parentElement;
  const glass = head?.querySelector('.home-head-glass');
  if (!head || !glass) return;
  const g = glass.getBoundingClientRect();
  const top = g.bottom - head.getBoundingClientRect().top + GAP;
  el.style.setProperty('--consent-top', Math.ceil(top) + 'px');
  if (getComputedStyle(el).position === 'fixed') {
    const right = el.getBoundingClientRect().right;
    el.style.setProperty('--consent-w', Math.min(DESK_W, Math.floor(right - g.right - GAP)) + 'px');
  } else {
    el.style.removeProperty('--consent-w');
  }
}

/** 条压着什么就返回要往下让多少（0 = 没压着）。 */
function overlapNeed(el: HTMLElement): number {
  const bar = el.getBoundingClientRect();
  let need = 0;
  for (const r of obstacles(bar)) {
    if (hits(bar, r, GAP)) need = Math.max(need, Math.ceil(bar.bottom + GAP - r.top));
  }
  return need;
}

/**
 * 完整版 → 紧凑版 → 内容整体往下让。
 *
 * 每一步都从「什么都没让」量起：量之前先把 `--consent-room` 清掉，不然量到的是上一次让过之后的
 * 位置——让开了，于是以为不用让，撤掉，又压上了，来回跳。
 */
function fit(): void {
  fitRaf = 0;
  const el = document.getElementById(ID);
  const p = page();
  if (!el || !p) return;
  p.style.removeProperty('--consent-room');
  place(el);
  paint(el, false);
  if (overlapNeed(el) === 0) {
    last = { compact: false, room: '' };
    return;
  }
  paint(el, true);
  let need = overlapNeed(el);
  if (need === 0) {
    last = { compact: true, room: '' };
    return;
  }
  // 宽版的网格是弹性盒里排的，往下让 N 像素未必真挪 N（上下的空隙会跟着重新分）：照量出来的再补，
  // 最多补三次。
  let room = 0;
  for (let i = 0; i < 3 && need > 0; i++) {
    room += need;
    p.style.setProperty('--consent-room', room + 'px');
    need = overlapNeed(el);
  }
  last = { compact: true, room: room + 'px' };
}

function scheduleFit(): void {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  // 两帧：鱼眼轴第一帧才把卡片摆到位（modeAxis 的 paint 走 requestAnimationFrame）。
  fitRaf = requestAnimationFrame(() => {
    fitRaf = requestAnimationFrame(fit);
  });
}

/**
 * 该不该摆出来，重新算一次。主菜单每次重画、换语言、隐私政策那扇窗里拨了开关之后都叫一次（main.ts
 * 的 syncScreenClass、relocalizeChrome，和那扇窗关掉的时候）。
 */
export function syncConsentBar(next?: Lang): void {
  if (next) lang = next;
  const host = document.querySelector<HTMLElement>(HOST);
  const had = document.getElementById(ID);
  if (!host || !wanted()) {
    if (had) remove();
    return;
  }
  const el = had && host.contains(had) ? had : make();
  if (el !== had) {
    had?.remove();
    host.appendChild(el);
  }
  const p = page();
  p?.classList.add('home-page--consent');
  // 照上一次量的样子先摆上（见 last），两帧后 fit 再量准。
  paint(el, last.compact);
  if (p && last.room) p.style.setProperty('--consent-room', last.room);
  if (el !== had && typeof ResizeObserver !== 'undefined') {
    glassWatch?.disconnect();
    // 手机那一档只看高度：副标题是一个字一个字打出来的（typeTagline），玻璃的**宽**每一拍都在变，可条的
    // 位置只跟着它的下沿走。电脑那一档宽也要看：条的宽要给招牌让出 12px（见 place）。
    let lastH = -1;
    let lastW = -1;
    glassWatch = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const h = Math.round(box?.height ?? 0);
      const w = Math.round(box?.width ?? 0);
      const bar = document.getElementById(ID);
      const desk = !!bar && getComputedStyle(bar).position === 'fixed';
      if (h === lastH && (!desk || w === lastW)) return;
      lastH = h;
      lastW = w;
      if (bar) scheduleFit();
    });
    const glass = host.querySelector('.home-head-glass');
    if (glass) glassWatch.observe(glass);
  }
  scheduleFit();
}

/**
 * 「有弹窗开着」的替身类：认得 `:has()` 的浏览器用 style.css 里那句 `:has(> .overlay)`，认不得的
 * （旧一点的 iOS Safari、安卓）看这个类。只盯 body 的直接子节点——全站的弹窗都挂在那一层，而盯子树
 * 会被棋盘每一帧的重建叫醒（main.ts 的 syncScreenClass 那段同一个理由）。
 */
function watchOverlays(): void {
  const sync = () =>
    document.documentElement.classList.toggle('has-overlay', !!document.querySelector('body > .overlay'));
  new MutationObserver(sync).observe(document.body, { childList: true });
  sync();
}

/** 开机叫一次（main.ts 的 afterLangChosen）。 */
export function armConsentBar(now: Lang, h: Hooks): void {
  lang = now;
  if (hooks) return;
  hooks = h;
  // 不配 GA、不在线上：连盯都不用盯。
  if (!gaConsentApplies()) return;
  watchOverlays();
  // 转屏、拖窗口、字体晚到一步（Karla / Fraunces 换上来之后字宽会变）：重新量。
  window.addEventListener('resize', () => {
    if (document.getElementById(ID)) scheduleFit();
  });
  document.fonts?.ready.then(() => {
    if (document.getElementById(ID)) scheduleFit();
  });
  syncConsentBar();
}
