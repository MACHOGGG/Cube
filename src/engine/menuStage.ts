/**
 * 主菜单一步一步出现（10-31 方案推12 Z-J02，站长 10-30）：没解锁的玩法**不出现**（不是挂锁），排布顺序不改。
 *
 *   第 1 步  只有经典小球（＋《我会玩》）
 *   第 2 步  经典方块出现（摆在小球前面）            ← E2：小球**教学局**走到结算页（slides_played_circle）
 *   第 3 步  每日挑战、多人、计时、炸弹             ← E3：方块教学局走到结算页（slides_played_square），或按过《我会玩》
 *   第 4 步  老虎机、无限反转、步步为营               ← E4：从每日挑战页 / 计时页 / 炸弹页开的一局，或小屋里打完一局（slides_played_tier3）
 *   第 5 步  四副布局（没登录挂锁）                   ← E5：从老虎机 / 无限反转 / 步步为营那三页开的一局（slides_played_tier4）
 *
 * 「走到结算页」那一下由 main.ts 记（showGame 的 onLive(false)，推06 的 pendingMarks 写完之后）：入口是哪一页只有 main.ts
 * 知道（老虎机局的 modeKey 是 'base'，控制器猜不出来），所以这个文件只管「证据 → 第几步」。
 *
 * 几条规矩：
 *   · **只升不降**：slides_played_stage 一律 Math.max 写回；清档、退出登录、换帐号都不动它。
 *   · **新人按顺序**（站长答复 ①）：stage = 1 + 从 E2 起连续成立了几条。提前打的更后阶段的局（例如先从个人主页输号码进小屋
 *     打完一局）证据记着，到了那一步一起补——仍一步一步出现。
 *   · **老玩家按最高一步**：只给开机那一次迁移和「本推上线以前打的局」用（adoptEvidence）。
 *   · **存不进 localStorage**（无痕窗口、容器关了存储）：一律当第 5 步，全部摆出来——和从前「读不到就当开过」同一个口径。
 *   · **`slides_tutorial_seen*` 只在 migrateMenuStageOnce 里读，别处不许读**：推19 小屋学规则点《完成》会写它（D61 B5），平时也
 *     认的话，新人在小屋里看一遍规则就跳过一步，违反「第 2 步要小球教学局走到结算页」。
 *
 * 这几把键（slides_played_stage / _stage_shown / _tier3 / _tier4、哨兵 slides_played_migrated_v1）都落在隐私政策「进度」那一类
 * 已有的 slides_played_ 前缀里（scripts/check-privacy-truth.mjs）。小红书那一端是另一套三步，不 import 这个文件。
 */
import type { RunData } from './runRecord';

export type MenuStage = 1 | 2 | 3 | 4 | 5;

/** 主菜单上的每一张卡，第几步出现（布局卡按 card id）。 */
export const STAGE_OF: Readonly<Record<string, MenuStage>> = Object.freeze({
  circle: 1,
  square: 2,
  daily: 3,
  multiplayer: 3,
  timed: 3,
  bomb: 3,
  slot: 4,
  flip: 4,
  puzzle: 4,
  squareDiamond: 5,
  circleHex: 5,
  circleSeven: 5,
  triangleBig: 5,
});

/**
 * 本推上线那一天（北京时间 2026-11-01 零点，UTC 2026-10-31 16:00）。存档里早于它的局是老玩家的旧战绩，按「最高一步」认；
 * 晚于它的局是新规矩下打的，只当证据记下、再按顺序（站长答复 ①）。
 */
export const MENU_STAGE_SINCE = Date.UTC(2026, 9, 31, 16, 0, 0);

const STAGE_KEY = 'slides_played_stage';
const SHOWN_KEY = 'slides_played_stage_shown';
const TIER3_KEY = 'slides_played_tier3';
const TIER4_KEY = 'slides_played_tier4';
const MIGRATED_KEY = 'slides_played_migrated_v1';

const clampStage = (n: number): MenuStage => Math.max(1, Math.min(5, Math.floor(n) || 1)) as MenuStage;

/**
 * 这台设备存得进 localStorage 吗（试写一把再删掉，只试一次）。
 *
 * 光看「读不读得到」不够：有的环境读得出来、一写就抛（容器关了写、存满了）。那样 slides_played_stage 永远是空的，
 * 读的那一头会当第 1 步——只剩一张小球，而且怎么打都升不上去（记不住）。所以写不进就当第 5 步，全部摆出来。
 */
let writable: boolean | null = null;
function canStore(): boolean {
  if (writable !== null) return writable;
  try {
    localStorage.setItem('slides_played_probe', '1');
    localStorage.removeItem('slides_played_probe');
    writable = true;
  } catch {
    writable = false;
  }
  return writable;
}

/** 存着的那一步。存不进 / 读不到（抛错）当第 5 步；没有这把键当第 1 步。 */
export function menuStage(): MenuStage {
  if (!canStore()) return 5;
  try {
    const raw = localStorage.getItem(STAGE_KEY);
    return raw === null ? 1 : clampStage(Number(raw));
  } catch {
    return 5;
  }
}

/** 只升不降地写回。存不进就算了（读的那一头会当第 5 步）。 */
function raiseTo(n: MenuStage): MenuStage {
  const now = menuStage();
  const next = clampStage(Math.max(now, n));
  try {
    if (next !== now || localStorage.getItem(STAGE_KEY) === null) localStorage.setItem(STAGE_KEY, String(next));
  } catch {
    return 5;
  }
  return next;
}

const flag = (k: string): boolean => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};

/** 这一局是从「第 3 步那四样」（tier 3）或「第 4 步那三样」（tier 4）的入口开的，走到了结算页：记一笔证据。 */
export function creditTier(t: 3 | 4): void {
  try {
    localStorage.setItem(t === 3 ? TIER3_KEY : TIER4_KEY, '1');
  } catch {
    /* 存不进：读的那一头当第 5 步 */
  }
}

/**
 * 按顺序算这一步并写回（平时每一次走到结算页、开机、按《我会玩》之后都叫它）。只认结算页写下的那几把证据键——
 * **不读 slides_tutorial_seen***（见文件头）。
 */
export function syncMenuStage(): MenuStage {
  const e2 = flag('slides_played_circle');
  const e3 = flag('slides_played_square') || flag('slides_know_how');
  const knows = flag('slides_know_how');
  const e4 = flag(TIER3_KEY);
  const e5 = flag(TIER4_KEY);
  // 《我会玩》等于 E2、E3 都成立（直接到第 3 步，E4、E5 照旧要打）。
  const chain = [e2 || knows, e3, e4, e5];
  let n = 1;
  for (const ok of chain) {
    if (!ok) break;
    n++;
  }
  return raiseTo(n as MenuStage);
}

export interface StageEvidence {
  e2: boolean;
  e3: boolean;
  e4: boolean;
  e5: boolean;
}

/** 按「有过的最高一步」升（老玩家、本推上线以前的局用）。 */
export function adoptEvidence(e: StageEvidence): MenuStage {
  const n: MenuStage = e.e5 ? 5 : e.e4 ? 4 : e.e2 && e.e3 ? 3 : e.e2 || e.e3 ? 2 : 1;
  return raiseTo(n);
}

/**
 * 一批存档里的局各算哪一档证据：计时、炸弹（三档）、每日挑战、小屋 → e4；不是小屋的老虎机、无限反转、步步为营 → e5；
 * 小球 / 方块的局 → e2 / e3（老玩家的基础局）。
 */
export function evidenceOfRuns(runs: readonly (RunData | null | undefined)[]): StageEvidence {
  const e: StageEvidence = { e2: false, e3: false, e4: false, e5: false };
  for (const d of runs) {
    if (!d || typeof d !== 'object') continue;
    const mode = String(d.modeKey ?? '');
    if (d.shapeId === 'circle') e.e2 = true;
    if (d.shapeId === 'square') e.e3 = true;
    if (d.room) {
      e.e4 = true;
      continue;
    }
    // 进阶炸弹的局 modeKey 也是 'bomb'（开在菱形方块、六边形小球上，runRecord.ts 的 ModeKey 没有单独一档）。
    if (mode === 'timed' || mode === 'bomb' || mode === 'bombTimed' || d.daily) e.e4 = true;
    if (d.slot || mode === 'flip' || mode === 'puzzle') e.e5 = true;
  }
  return e;
}

/** 按 MENU_STAGE_SINCE 把局分成「上线以前」「上线以后」两堆。 */
export function splitBySince<T extends { at?: number } | null | undefined>(runs: readonly T[]): { before: T[]; after: T[] } {
  const before: T[] = [];
  const after: T[] = [];
  for (const r of runs) (Number(r?.at) < MENU_STAGE_SINCE ? before : after).push(r);
  return { before, after };
}

/**
 * 吃一批局：上线以前的按最高一步（adoptEvidence），上线以后的只记 tier 证据、再按顺序（syncMenuStage）——新人在新规矩下
 * 打的局不能绕过顺序（站长答复 ①）。开机扫本机存档、云端接回之后都走这儿。
 */
export function absorbRuns(runs: readonly (RunData | null | undefined)[]): MenuStage {
  const { before, after } = splitBySince(runs);
  if (before.length) adoptEvidence(evidenceOfRuns(before));
  const late = evidenceOfRuns(after);
  if (late.e4) creditTier(3);
  if (late.e5) creditTier(4);
  return syncMenuStage();
}

/** 主菜单真的画出来过的是第几步（判「哪几张是新的」用）。没有就当和现在一样（不演）——第一次开机不演一遍全部。 */
export function stageShown(): MenuStage {
  if (!canStore()) return 5;
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    return raw === null ? menuStage() : clampStage(Number(raw));
  } catch {
    return 5;
  }
}

export function markStageShown(n: MenuStage): void {
  try {
    localStorage.setItem(SHOWN_KEY, String(n));
  } catch {
    /* 存不进：下次照样当演过（stageShown 读不到回 5） */
  }
}

/**
 * 开机一次性迁移（哨兵 slides_played_migrated_v1，跑过不再跑）。**只在本机还没有 slides_played_stage 时才迁**——有这把键
 * 说明这台设备已经在新规矩下了，只写哨兵。全新设备第一次开机也跑这一趟（那时旧键全空，结果是第 1 步）。
 *
 * 按「有过的最高一步」：E2 ← slides_played_circle 或 slides_tutorial_seen_circle；E3 ← slides_played_square 或
 * slides_tutorial_seen（含带后缀的 slides_tutorial_seen_*，按前缀判，小球那一把除外）；E4 ← slides_played_timed / _bomb，或本机
 * 存档里有计时、炸弹、每日、小屋的局；E5 ← slides_played_slot / _flip / _puzzle，或存档里有不是小屋的老虎机、无限反转、步步为营
 * 的局。存档只看本推上线以前的（MENU_STAGE_SINCE）。
 */
export function migrateMenuStageOnce(localRuns: readonly (RunData | null | undefined)[]): void {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === '1') return;
    if (localStorage.getItem(STAGE_KEY) !== null) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return;
    }
    const keys = Object.keys(localStorage);
    // 方块那一档认 slides_tutorial_seen 和带后缀的那几把（按前缀判），**小球自己那一把除外**——它是 E2 的证据；连它也算进
    // 来的话，只看过小球的老玩家会被当成两局都打过（check-menu-stages 第 8 节）。
    const seenSquare = keys.some((k) => k.startsWith('slides_tutorial_seen') && k !== 'slides_tutorial_seen_circle');
    // 只认本推上线以前的局（老玩家的旧战绩）；以后的局交给开机那一趟 absorbRuns 按顺序算（新人在新规矩下打的局不能绕过
    // 顺序——check-menu-stages 第 9 节）。
    const runs = evidenceOfRuns(splitBySince(localRuns).before);
    const e: StageEvidence = {
      e2: flag('slides_played_circle') || flag('slides_tutorial_seen_circle') || runs.e2,
      e3: flag('slides_played_square') || seenSquare || runs.e3,
      e4: flag('slides_played_timed') || flag('slides_played_bomb') || runs.e4,
      e5: flag('slides_played_slot') || flag('slides_played_flip') || flag('slides_played_puzzle') || runs.e5,
    };
    adoptEvidence(e);
    // 第一次画主菜单不演「新卡浮出」：老玩家开机就该看到和昨天一样多的卡，新人只有小球一张。
    markStageShown(menuStage());
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    /* 存不进：menuStage 读不到当第 5 步 */
  }
}
