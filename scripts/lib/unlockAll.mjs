/**
 * 门的夹具：「什么都解锁了的老玩家」（10-31 方案推12 Z-J02 门第 1 条）。
 *
 * 主菜单一步一步出现之后（engine/menuStage.ts），什么都不预设的浏览器只看得到一张小球；只预设 `slides_tutorial_seen` 的
 * 门（原先拿它绕首玩锁）迁移完是第 2 步，菜单上只有两张卡。所以要量「十三张都在」的门一律先铺这一份：
 *
 *   · 主菜单第 5 步、而且已经画过第 5 步（`stage_shown = 5`，别的门里不演新卡浮出）、迁移哨兵写过；
 *   · 两局教学的记号（circle、square）和两档证据（tier3、tier4）都在——只升不降那一套从哪个口算都是第 5 步；
 *   · 开局倒数页那颗色盲开关已经出过（`slides_cvd_offer`）；
 *   · 每个玩法的局中灯泡都满两局了（`slides_bulb_*` = 2），别的门默认看不到灯泡（check-hint-bulb 自己清掉）。
 *
 * **不带登录**：原先只预设 tutorial_seen 的那批门是没登录的人，照旧没登录（更多布局四副挂锁）。要「登着」的门给
 * `{ signedIn: true }`：铺一份本机登录缓存（兑过一张码的样子：channel 'code'、有 code、没有令牌——不带令牌是故意的：
 * 开机接云那一趟问的是 auth()，没令牌就一趟都不发，不会被 dev-server 回 401、页面不会冒「登录已过期」）。门自己
 * 后面再写的 slides_genius 照样盖得过它（注册顺序：先铺这一份，门自己的 addInitScript 后跑）。
 *
 * 小红书那一端（预览页）用 `XHS_UNLOCK_ALL`：第 3 步、画过第 3 步、哨兵、色盲开关出过、灯泡满两局。
 * **不建** `slides_played_advanced`（方案原话）。
 *
 * 用法（addInitScript 的函数体拿不到外面的变量，所以把键值当参数递进去）：
 *
 *   import { unlockAll } from './lib/unlockAll.mjs';
 *   const ctx = await browser.newContext(…);
 *   await unlockAll(ctx);                     // 或 unlockAll(ctx, { signedIn: true })、unlockAll(page)
 */

/** 局中灯泡按哪几个玩法数（engine/hintBulb.ts、main.ts 的 bulbKey）。 */
export const BULB_KEYS = ['square', 'circle', 'timed', 'bomb', 'slot', 'flip', 'puzzle', 'layout', 'daily'];

export const UNLOCK_ALL = Object.freeze({
  slides_played_finished: '1',
  slides_played_circle: '1',
  slides_played_square: '1',
  slides_played_tier3: '1',
  slides_played_tier4: '1',
  slides_played_stage: '5',
  slides_played_stage_shown: '5',
  slides_played_migrated_v1: '1',
  slides_cvd_offer: '1',
  // 无限反转结算页那一句头一回才摆（推14 Z-B07）：不预设的话，所有打反转的门头一局多一行字。要量「头一回」的门
  // （推15 的 check-flip-batch）在 unlockAll 之后自己删掉这一把。
  slides_played_fliptip: '1',
  ...Object.fromEntries(BULB_KEYS.map((k) => [`slides_bulb_${k}`, '2'])),
});

/** 「登着」的那一份本机缓存（见文件头：兑过一张码、没有令牌）。 */
export const SIGNED_IN_CACHE = JSON.stringify({ active: true, channel: 'code', code: 'GATEUNLOCK', until: 4102444800000 });

export const XHS_UNLOCK_ALL = Object.freeze({
  'slides.xhs.stage': '3',
  'slides.xhs.stageShown': '3',
  'slides.xhs.stageMigrated': '1',
  'slides.xhs.cvdOffer': '1',
  ...Object.fromEntries(BULB_KEYS.map((k) => [`slides.xhs.bulb.${k}`, '2'])),
});

/**
 * 在页面里跑：把一组键写进 localStorage（存不进就算了——那是门自己在测「存不进」）。
 *
 * **登录缓存（slides_genius）只在还没有的时候铺**：addInitScript 每次导航都跑，门自己兑码拿到真令牌、写进去再刷新，要是
 * 这儿又把那份假的盖回去，开小屋那一下就没有令牌了（check-room-slot 头一次就是这么红的）。
 */
export function seedStorage(kv) {
  for (const [k, v] of Object.entries(kv)) {
    try {
      if (k === 'slides_genius' && localStorage.getItem(k) !== null) continue;
      localStorage.setItem(k, v);
    } catch {
      /* 门自己把 localStorage 关了 */
    }
  }
}

/**
 * 给一个 BrowserContext 或 Page 铺上「什么都解锁了」。`signedIn` 再铺一份本机登录缓存；`xhs` 铺小红书那一份；`extra` 是门
 * 自己要多写的几把（同一个时机写进去）。
 */
export function unlockAll(target, { signedIn = false, xhs = false, extra = {} } = {}) {
  const kv = { ...(xhs ? XHS_UNLOCK_ALL : UNLOCK_ALL), ...(signedIn ? { slides_genius: SIGNED_IN_CACHE } : {}), ...extra };
  return target.addInitScript(seedStorage, kv);
}
