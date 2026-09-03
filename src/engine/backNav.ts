/**
 * 浏览器 / 手机的「返回」＝回站内的上一屏。
 *
 * 整站是一张网页，从主菜单进个人主页、进一局、开一个弹窗，地址栏都不变；浏览
 * 器不知道站内有「上一屏」，手机的返回手势、浏览器的 ← 按下去就直接退出网站。
 *
 * 做法：浏览器历史里最多放两条——底下一条「根」，上面一条「哨兵」。不在主菜单
 * 上（进了别的屏、或者开着弹窗）就立着哨兵：玩家按返回，浏览器从哨兵退到根，
 * 我们收到 popstate，就做当前这一屏该做的事——弹窗开着先关弹窗；一局打着先暂停
 * （暂停着再按就继续）；小屋里问一句要不要离开；其余页面等同各自那颗《返回》。
 * 做完看看还要不要哨兵：还在别的屏上就推回去，回到了主菜单就不推。主菜单上不留
 * 哨兵，所以那一下返回是浏览器自己的事：真的离开网站，和从前一样。
 *
 * 两类登记：
 *   · setScreenBack(fn)：这一屏的返回做什么；null 就是主菜单（真退出）。每个画屏
 *     的函数画完就登记一次，后画的盖掉先画的。
 *   · pushLayer(close, el)：一个弹窗开了。返回先关最上面那个还开着的；弹窗自己
 *     关掉不用注销——元素不在文档里了就当它关了，下一次返回时顺手清掉。
 *
 * 站内所有《返回》《退出》键照旧直接换屏，不必知道这个模块的存在：换到哪一屏，
 * 那一屏自己登记，这里只负责哨兵该在还是该撤（撤，是我们自己往回退一步，那一次
 * popstate 不算返回）。
 */
type Handler = () => void;

interface Layer {
  close: Handler;
  alive: () => boolean;
}

const ROOT_STATE = { slides: 'root' } as const;
const GUARD_STATE = { slides: 'guard' } as const;

let screenBack: Handler | null = null;
const layers: Layer[] = [];
/** 哨兵在不在历史里——在，下一次返回才落到我们手上。 */
let armed = false;
let installed = false;
/** 我们自己退的那几步（撤哨兵）：接下来这么多次 popstate 不是玩家按的返回。 */
let suppress = 0;

function stateOf(st: unknown): string | null {
  if (!st || typeof st !== 'object') return null;
  const v = (st as { slides?: unknown }).slides;
  return typeof v === 'string' ? v : null;
}

function arm() {
  if (armed) return;
  try {
    history.pushState(GUARD_STATE, '');
    armed = true;
  } catch {
    /* 没有历史接口的老浏览器：返回键照旧是浏览器自己的事 */
  }
}

export function installBackNav(): void {
  if (installed || typeof history === 'undefined') return;
  installed = true;
  // 退到根上时浏览器会想把滚动位置复原到「那一条」当年的位置——滚动我们自己管
  //（主菜单、个人主页各记着自己的位置），别让它插手。
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const st = stateOf(history.state);
  if (st === 'guard') {
    // 刷新回来：停在哨兵上，根还在它底下。第一屏画出来登记的时候会决定留不留它。
    armed = true;
  } else if (st !== 'root') {
    history.replaceState(ROOT_STATE, '');
  }
  window.addEventListener('popstate', onPop);
  // 弹窗自己关掉（按了它的《关闭》、点了外面）时没人通知这里：盯着 body 的孩子，
  // 少了一层就重新算一遍还要不要哨兵——主菜单上关掉最后一扇窗，哨兵就撤。
  if (typeof MutationObserver !== 'undefined' && document.body) {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        sync();
      });
    }).observe(document.body, { childList: true });
  }
}

/** 撤掉哨兵：我们自己往回退一步，那一次 popstate 不算玩家按的返回。 */
function disarm() {
  if (!armed) return;
  armed = false;
  if (stateOf(history.state) === 'guard') {
    suppress++;
    history.back();
  }
}

/** 按现在的情形决定哨兵该在还是该撤。 */
function sync() {
  if (screenBack || topLayer()) arm();
  else disarm();
}

function onPop(e: PopStateEvent) {
  const st = stateOf(e.state);
  // 撤哨兵时我们自己退的那一步：不是返回。
  if (suppress > 0) {
    suppress--;
    if (st !== 'guard') armed = false;
    return;
  }
  // 按了「前进」又回到哨兵上：那不是返回，不理。
  if (st === 'guard') {
    armed = true;
    return;
  }
  // 现在停在根上，哨兵已经用掉。
  armed = false;
  // 落到了一条不是我们写的（状态被别处抹掉了）：把它当根重新记上，这一下不算。
  if (st !== 'root') {
    history.replaceState(ROOT_STATE, '');
    sync();
    return;
  }
  const layer = topLayer();
  if (layer) {
    layer.close();
    sync();
    return;
  }
  if (screenBack) {
    screenBack();
    sync();
    return;
  }
  // 主菜单本不该立着哨兵；万一有（撤的那一步还没走完），这一下就算退出：再退一
  // 步，退到进站之前那一页。直接打开的（前面没有页）什么都不发生，和从前一样。
  history.back();
}

function topLayer(): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) if (!layers[i].alive()) layers.splice(i, 1);
  return layers.length ? layers[layers.length - 1] : null;
}

/** 这一屏按返回做什么。null = 主菜单，那一下真的退出网站。每画完一屏登记一次。 */
export function setScreenBack(fn: Handler | null): void {
  screenBack = fn;
  sync();
}

/**
 * 一个弹窗开了：返回先关它。alive 说它还开着没有（不给就看元素还在不在文档
 * 里）；关掉之后不用注销，下一次返回会把已经不在的自动清掉。
 */
export function pushLayer(close: Handler, el: Element, alive?: () => boolean): void {
  topLayer();
  layers.push({ close, alive: alive ?? (() => el.isConnected) });
  arm();
}
