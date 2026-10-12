/**
 * 主菜单招牌底下那一格：两张卡共用的位置、躲让规矩和叠放（10-11 方案 A-14 ＋ B-9）。
 *
 * 住在这一格里的有两张卡：GA 同意条（ui/consentBar.ts）和「有新版本」卡（ui/newVersionCard.ts）。样子是同
 * 一套（「② 奶油磨砂卡」，style.css 的 `.home-card`），位置也是同一个：
 *
 *   · 手机（窄版，鱼眼轴那一路）：招牌下沿往下 12px，左右各 16px。招牌那一层本来就盖在轴上（z 60），卡片从
 *     它底下滑过去，这一格跟着招牌住，所以是同一个规矩：滑过去的卡从它底下走，它不新占走「静止时」任何一块
 *     点得着的地方；
 *   · 电脑（≥1000 宽）：右上角，离右边、上边各 24px，宽 360px；
 *   · 量出来还是压到了玩法卡（法语 360×740、320×568、电脑 1000×700 这几档）：先换短一句的紧凑版（有紧凑版的
 *     卡才换——同意条有，更新卡本来就是一句话）；还压到，就让主菜单的内容整体往下让（`--consent-room`，
 *     style.css 里鱼眼轴的中线和宽版网格都认它），卡一走就复原。
 *
 * 只在**主菜单**上：两张卡都住在主菜单那块招牌的盒子里（`.home-page .home-head`），换屏就是换掉那一棵 DOM——
 * 对局、倒数、小屋那几屏上它们根本不存在。任何弹窗开着的时候藏起来（style.css 的 `.home-card` 那段：
 * `:has()` 认得出就用它，认不出就用这儿盖在 `<html>` 上的 `has-overlay`）。
 *
 * ── 两张都要出的时候（玩家定的 Q6） ─────────────────────────────────
 *
 * 同意条在上层；更新卡叠在它底下，只露出下沿一截：底边比同意条低 8px、缩到 0.96（从底边往里缩，露出来那一截
 * 左右各收 2%）。要往下让的话，按叠起来的总高度（多那 8px）算。他答了同意条（接受或拒绝）：同意条向上滑走并
 * 淡出（−16px、260ms、ease-in），更新卡同时从底下升到原位、放大回 1（260ms、ease-out、晚 60ms 起步）——「上下
 * 两侧交替」。减弱动态下直接换、不滑。
 */
import type { Lang } from '../i18n';

/** 住进这一格的一张卡。 */
export interface SlotCard {
  /** 那张卡的 DOM id。 */
  id: string;
  /** 越小越在上层：同意条 0、更新卡 1。 */
  rank: number;
  /** 窄屏压到卡片时有没有短一句的紧凑版可换。 */
  compactable: boolean;
  /** 这一刻该不该摆出来（主菜单在不在由这一格自己看，卡只管自己的条件）。 */
  wanted(): boolean;
  /** 新建这张卡的 DOM（字由 paint 填）。 */
  make(): HTMLElement;
  /** 把字填成这一种语言、这一档。 */
  paint(el: HTMLElement, compact: boolean, lang: Lang): void;
}

/** 住在主菜单招牌那个盒子里。前缀 `.home-page` 不是装饰：`.home-head` 全站有好几处，小屋那两屏上也有。 */
const HOST = '.home-page .home-head';
/** 卡和招牌、卡片之间至少留多少。 */
const GAP = 12;
/** 叠着的时候，底下那张比上面那张多露出来的那一截。 */
const LIP = 8;
/** 上面那张走掉、底下那张升上来一共多久：260ms，晚 60ms 起步，再留一点余量才收尾。 */
const SWAP_MS = 340;

const cards: SlotCard[] = [];
let lang: Lang = 'zhHans';
let armed = false;
let fitRaf = 0;
/** 盯着招牌那块玻璃的高度：换语言折了行、字体晚到，玻璃一长，卡就得跟着往下挪。 */
let glassWatch: ResizeObserver | null = null;
/** 盯的是哪一块玻璃：主菜单每次重画都是一块新的，旧的那块已经不在页面上了。 */
let watchedGlass: Element | null = null;
/**
 * 上一次量出来的结果（紧凑没有、往下让了多少）。主菜单每次重画都是一棵新的 DOM，新的卡要等两帧才量得了——这两
 * 帧里先照上一次的样子摆，不然 320 宽的屏上每回到一次主菜单，同意条就先闪成完整版、整条轴先弹回原处再往下让
 * 一下。量完以 fit 为准。
 */
let last = { compact: false, room: '' };

interface Live {
  card: SlotCard;
  el: HTMLElement;
}

function page(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.home-page');
}

/** 此刻摆着、而且不是正在走的那几张，上层在前。 */
function liveCards(): Live[] {
  const out: Live[] = [];
  for (const card of cards) {
    const el = document.getElementById(card.id);
    if (el && !el.classList.contains('home-card--leaving')) out.push({ card, el });
  }
  return out;
}

/** 上下两层的类：只有一张的时候两个类都不挂。 */
function arrange(live: Live[]): void {
  live.forEach(({ el }, i) => {
    el.classList.toggle('home-card--front', live.length > 1 && i === 0);
    el.classList.toggle('home-card--back', live.length > 1 && i > 0);
  });
}

/**
 * 底下那张往下错多少：两张的上沿是同一个（都是 `--consent-top`），缩放的原点在底边，所以要让它的底边落在上面
 * 那张底边往下 LIP 处，就得往下挪「两张高度之差 + LIP」。高度量的是布局高度（offsetHeight，不受变换影响）。
 */
function stack(live: Live[]): void {
  if (live.length < 2) return;
  const frontH = live[0].el.offsetHeight;
  for (const { el } of live.slice(1)) {
    el.style.setProperty('--stack-dy', Math.round(frontH - el.offsetHeight + LIP) + 'px');
  }
}

/** 电脑那一档的宽（方案 A-14：右上角，宽 360）。 */
const DESK_W = 360;

/** 这张卡是不是在电脑那一档（style.css 里是 position: fixed，右上角）。 */
const onDesk = (el: HTMLElement): boolean => getComputedStyle(el).position === 'fixed';

/**
 * 手机上的 top：招牌那块玻璃的下沿往下 12px，量出来写进 `--consent-top`（相对 `.home-head`）。向上取整：宁可多
 * 半个像素，不要少——少了就不到 12px。电脑那一档在 style.css 里写死 top: 24px，这个变量在那儿不起作用。
 *
 * 电脑那一档另量一样：招牌是居中的，副标题一个字一个字打出来，法语那一句打完之后在 1000 宽上把招牌撑到右沿 617，
 * 而卡的左沿在 616——压上去了（1000–1023 宽都离不出 12px）。右边那一截放不下「360 宽 + 离招牌 12」时卡收窄一点
 * （`--consent-w`，1000 宽的法语是 348），别的语言、宽一点的屏照旧 360。
 */
function place(el: HTMLElement): void {
  const head = el.parentElement;
  const glass = head?.querySelector('.home-head-glass');
  if (!head || !glass) return;
  const g = glass.getBoundingClientRect();
  const top = g.bottom - head.getBoundingClientRect().top + GAP;
  el.style.setProperty('--consent-top', Math.ceil(top) + 'px');
  if (onDesk(el)) {
    const right = el.getBoundingClientRect().right;
    el.style.setProperty('--consent-w', Math.min(DESK_W, Math.floor(right - g.right - GAP)) + 'px');
  } else {
    el.style.removeProperty('--consent-w');
  }
}

/**
 * 两个矩形之间（留出 gap 的余量）有没有交叠。
 *
 * 减掉 1px 的容差：招牌那块玻璃的下沿常常落在小数像素上（104.4），卡的上沿是取整写进去的，差那零点几像素就
 * 会被算成「压到了」——同意条第一版就这么红过：法语 390×844 上它把主菜单往下推了 735px。
 */
function hits(a: Box, b: Box, gap: number): boolean {
  const g = gap - 1;
  return a.left < b.right + g && b.left < a.right + g && a.top < b.bottom + g && b.top < a.bottom + g;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 这一格底下那一带有几样东西要躲：玩法卡（看得见、点得着的那两块——图和卡底下那行小字）、两侧的点点、
 * 《我会玩》。这几样都跟着 `--consent-room` 往下走，所以压到了可以让。
 *
 * 招牌和底排不在这儿：一个在这一格上面、一个钉在屏幕底下，往下让一个也让不开（招牌那 12px 由 place 摆出来，
 * 电脑那一档右上角离招牌二十多像素；三者不相交由门 check-consent / check-new-version 在六种尺寸上量）。
 *
 * 鱼眼轴上（竖屏手机）卡片只算**上沿在这一格的上沿之下**的：停在中间某一张的时候，它上面那几张本来就从招牌底下
 * 滑过去（招牌也盖着它们），那不是这一格压的，让也让不开——全轴往下挪，上面那几张照样在那一带。
 *
 * 宽版（电脑、手机横过来）没有鱼眼轴，卡片不从招牌底下滑过去，一张都不许压：手机横过来（844×390、812×375）时第一
 * 排两张卡的上沿（84）正好比这一格的上沿（85）高一个像素，照竖屏那条规矩不算，卡就整块压在它们身上、还收走它们的
 * 点击（10-11 写这张更新卡时量出来的；同意条那一推一起改了）。
 */
function obstacles(top: number): Box[] {
  const out: Box[] = [];
  const vh = window.innerHeight;
  const wide = !!document.querySelector('.home-page--wide');
  for (const el of Array.from(
    document.querySelectorAll('.home-page .home-icon-art, .home-page .home-icon-tag, .home-page .axis-rail, .home-page .know-how-btn'),
  )) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= vh) continue;
    if (!wide && r.top < top) continue;
    out.push(r);
  }
  return out;
}

/** 这一格（叠着的话连底下露出来的那一截）压着什么就返回要往下让多少（0 = 没压着）。 */
function overlapNeed(live: Live[]): number {
  const rs = live.map(({ el }) => el.getBoundingClientRect());
  const box: Box = {
    left: Math.min(...rs.map((r) => r.left)),
    top: Math.min(...rs.map((r) => r.top)),
    right: Math.max(...rs.map((r) => r.right)),
    bottom: Math.max(...rs.map((r) => r.bottom)),
  };
  let need = 0;
  for (const r of obstacles(box.top)) {
    if (hits(box, r, GAP)) need = Math.max(need, Math.ceil(box.bottom + GAP - r.top));
  }
  return need;
}

function paintAll(live: Live[], compact: boolean): void {
  for (const { card, el } of live) card.paint(el, compact && card.compactable, lang);
}

/**
 * 完整版 → 紧凑版 → 内容整体往下让。
 *
 * 每一步都从「什么都没让」量起：量之前先把 `--consent-room` 清掉，不然量到的是上一次让过之后的位置——让开了，
 * 于是以为不用让，撤掉，又压上了，来回跳。
 */
function fit(): void {
  fitRaf = 0;
  const live = liveCards();
  const p = page();
  if (!live.length || !p) return;
  p.style.removeProperty('--consent-room');
  for (const { el } of live) place(el);
  paintAll(live, false);
  stack(live);
  if (overlapNeed(live) === 0) {
    last = { compact: false, room: '' };
    return;
  }
  const compactable = live.some(({ card }) => card.compactable);
  if (compactable) {
    paintAll(live, true);
    stack(live);
    if (overlapNeed(live) === 0) {
      last = { compact: true, room: '' };
      return;
    }
  }
  // 宽版的网格是弹性盒里排的，往下让 N 像素未必真挪 N（上下的空隙会跟着重新分）：照量出来的再补，最多补三次。
  let room = 0;
  let need = overlapNeed(live);
  for (let i = 0; i < 3 && need > 0; i++) {
    room += need;
    p.style.setProperty('--consent-room', room + 'px');
    need = overlapNeed(live);
  }
  last = { compact: compactable, room: room + 'px' };
}

function scheduleFit(): void {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  // 两帧：鱼眼轴第一帧才把卡片摆到位（modeAxis 的 paint 走 requestAnimationFrame）。
  fitRaf = requestAnimationFrame(() => {
    fitRaf = requestAnimationFrame(fit);
  });
}

function watchGlass(host: HTMLElement): void {
  const glass = host.querySelector('.home-head-glass');
  if (!glass || glass === watchedGlass || typeof ResizeObserver === 'undefined') return;
  stopWatchingGlass();
  watchedGlass = glass;
  // 手机那一档只看高度：副标题是一个字一个字打出来的（typeTagline），玻璃的**宽**每一拍都在变，可这一格的位置
  // 只跟着它的下沿走。电脑那一档宽也要看：卡的宽要给招牌让出 12px（见 place）。
  let lastH = -1;
  let lastW = -1;
  glassWatch = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    const h = Math.round(box?.height ?? 0);
    const w = Math.round(box?.width ?? 0);
    const live = liveCards();
    const desk = live.some(({ el }) => onDesk(el));
    if (h === lastH && (!desk || w === lastW)) return;
    lastH = h;
    lastW = w;
    if (live.length) scheduleFit();
  });
  glassWatch.observe(glass);
}

function stopWatchingGlass(): void {
  glassWatch?.disconnect();
  glassWatch = null;
  watchedGlass = null;
}

/**
 * 该摆哪几张，重新算一次。主菜单每次重画、换语言、隐私政策那扇窗关掉、发现了新版本、刚打完一局的那两分钟过去
 * 之后都叫一次（main.ts 的 syncScreenClass、relocalizeChrome，和两张卡自己）。
 */
export function syncHomeSlot(next?: Lang): void {
  if (next) lang = next;
  const host = document.querySelector<HTMLElement>(HOST);
  for (const card of cards) {
    const had = document.getElementById(card.id);
    // 正在走的那一张（上面那张答完、滑走的那 340ms）：让它走完，别在半路上把它拔掉或者再放一张。
    if (had?.classList.contains('home-card--leaving')) continue;
    if (!host || !card.wanted()) {
      had?.remove();
      continue;
    }
    if (had && host.contains(had)) continue;
    had?.remove();
    host.appendChild(card.make());
  }
  const live = liveCards();
  const p = page();
  if (!live.length) {
    stopWatchingGlass();
    p?.style.removeProperty('--consent-room');
    return;
  }
  arrange(live);
  // 照上一次量的样子先摆上（见 last），两帧后 fit 再量准。
  paintAll(live, last.compact);
  if (p && last.room) p.style.setProperty('--consent-room', last.room);
  if (host) watchGlass(host);
  scheduleFit();
}

/**
 * 上面那张走（同意条答完了）：它向上滑走、淡出，底下那张升到原位。只有它一张、或者减弱动态，就直接撤。走完再整
 * 个量一遍——少了一张，可能不用再往下让了。
 */
export function leaveSlot(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const rest = liveCards().filter((x) => x.el !== el);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!rest.length || reduce) {
    el.remove();
    syncHomeSlot();
    return;
  }
  el.classList.remove('home-card--front');
  el.classList.add('home-card--leaving');
  for (const x of rest) x.el.classList.add('home-card--rise');
  // 剩下那一张不再是「底下那张」：摘掉那个类，它就从错开、缩着的样子过渡回原位（过渡挂在 --rise 上）。
  arrange(rest);
  window.setTimeout(() => {
    el.remove();
    for (const x of rest) x.el.classList.remove('home-card--rise');
    syncHomeSlot();
  }, SWAP_MS);
}

/**
 * 「有弹窗开着」的替身类：认得 `:has()` 的浏览器用 style.css 里那句 `:has(> .overlay)`，认不得的（旧一点的 iOS
 * Safari、安卓）看这个类。只盯 body 的直接子节点——全站的弹窗都挂在那一层，而盯子树会被棋盘每一帧的重建叫醒
 * （main.ts 的 syncScreenClass 那段同一个理由）。
 */
function watchOverlays(): void {
  const sync = () =>
    document.documentElement.classList.toggle('has-overlay', !!document.querySelector('body > .overlay'));
  new MutationObserver(sync).observe(document.body, { childList: true });
  sync();
}

/** 一张卡住进来（两张卡各自开机时叫一次）。头一张进来的时候把这一格要盯的几样装上，只装一次。 */
export function registerSlotCard(card: SlotCard, now: Lang): void {
  lang = now;
  if (cards.some((c) => c.id === card.id)) return;
  cards.push(card);
  cards.sort((a, b) => a.rank - b.rank);
  if (armed) return;
  armed = true;
  watchOverlays();
  // 转屏、拖窗口、字体晚到一步（Karla / Fraunces 换上来之后字宽会变）：重新量。
  window.addEventListener('resize', () => {
    if (liveCards().length) scheduleFit();
  });
  document.fonts?.ready.then(() => {
    if (liveCards().length) scheduleFit();
  });
}
