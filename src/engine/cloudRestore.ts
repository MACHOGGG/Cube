/**
 * 登录之后，把云上那份战绩取回这台设备。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这一步
 *
 * 每打完一局，会往服务器报一份（cloudScores.pushRun），服务器把整局的原始数
 * 据都存着。但那份存档从来没有被取回来过——记录页读的一直只是这台设备
 * localStorage 里的那份。于是只要这台设备的存储换了一个地方，玩家看到的就是
 * 一张白纸，尽管服务器上什么都没丢：
 *
 *   · iOS 上「添加到主屏幕」之后，那个图标打开的是一个独立的存储空间，和
 *     Safari 里的完全不通——这一条最容易撞上，因为界面看起来一模一样；
 *   · 换了手机、换了浏览器、清过网站数据；
 *   · 域名不一样（www 和不带 www 是两个存储空间）；
 *   · Safari 的存储清理策略。
 *
 * 玩家看到的是「重新登录之后累计得分和所有成绩都没了」。所以登录这件事必须
 * 把云上那份接回来——这也正是「登录」对玩家的意义。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 取回来的那几局没有棋盘照片（上报时只报了原始数据，没报照片），所以战绩图
 * 重画不出来；记录那一行、那个分数、以及累计得分都回来了。
 */
import { fetchMine, signedIn } from './cloudScores';
import { entitlement, signedInEmail } from './subscription';
import { mergeRuns, type StoredRun } from './persistence';
import type { RunData } from './runRecord';

/** 一局归到哪个本地存档键下。认不出来的玩法返回 null（跳过，不猜）。 */
export type RunKeyFor = (data: RunData) => string | null;

/**
 * 同一个账号只取一次：开屏、个人主页、记录页都会叫它，没必要问三遍。
 *
 * 记的是「上次给谁取的」而不是一个是非值——换了账号、退出再登录，身份变了
 * 就该重新取一遍。刚打开还没登录的时候身份是空的，登录之后自然对不上，于是
 * 那一刻就会去取，不用谁来通知。
 */
let restoredFor = '';
let running: Promise<number> | null = null;

/** 现在是谁：邮箱，或者内部码。都没有就是空的（没登录）。 */
const whoAmI = (): string => signedInEmail() || entitlement().code || '';

/**
 * 取回来并入本地，返回补回了几局。
 *
 * 没登录、取不到、云上是空的——都返回 0，什么也不动。绝不会删本地任何一局：
 * 这一步只做加法。
 */
export function restoreCloudRuns(keyFor: RunKeyFor): Promise<number> {
  const me = whoAmI();
  if (!me || restoredFor === me || !signedIn()) return Promise.resolve(0);
  if (running) return running;
  running = (async () => {
    const mine = await fetchMine();
    if (!mine || !Array.isArray(mine.archive)) {
      // 没取到就不算取过——下次进来再试（可能只是这一下没网）。
      running = null;
      return 0;
    }
    restoredFor = me;
    running = null;
    const byKey = new Map<string, StoredRun[]>();
    for (const entry of mine.archive) {
      const data = entry?.data;
      if (!data || typeof data.at !== 'number') continue;
      const key = keyFor(data);
      if (!key) continue;
      const list = byKey.get(key) ?? [];
      list.push({ at: data.at, data, start: null, end: null });
      byKey.set(key, list);
    }
    let added = 0;
    for (const [key, list] of byKey) added += mergeRuns(key, list);
    return added;
  })();
  return running;
}
