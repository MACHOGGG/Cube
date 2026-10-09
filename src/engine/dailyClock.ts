/**
 * 每日挑战用的「现在」（第 19 推）。
 *
 * 方案原话：「网页端用服务器时间（serverTime()），小红书用本机时间」。今天是哪一天、今天的种
 * 子是哪一串，全看这一个数——设备的钟拨快了一天，他打的就是明天的挑战，而服务器（它只信自己
 * 的钟，见 api/scores.js 的 pushDaily）会把那一局当成伪造的拒掉。
 *
 * 网页端不在小屋里的时候，room.ts 的 serverTime() 其实就是本机的钟——它的偏移只从小屋接口的
 * 回包里量。所以这儿另外量一次：对首页发一个 HEAD，读回包头里的 `Date`（任何一台服务器都带，
 * 不是新接口——方案要求不新增函数，Vercel 的方案对函数个数有上限）。`Date` 只精确到秒，取那
 * 一秒的正中（+500ms），对「今天是几号」绰绰有余。小屋那边量过（往返最短的那一份，精确到毫
 * 秒）就用那边的。
 *
 * 量不到（离线、被拦）就用本机的钟：每日挑战照样能打，只是钟错了的设备打的那一局进不了今日榜。
 */
import { hasServerClock, serverTime } from './room';
import { fetchWithTimeout } from './fetchTimeout';

/** 服务器的钟减本机的钟（从 `Date` 头量的）。没量过就是 null。 */
let headerOffset: number | null = null;
let syncing: Promise<void> | null = null;

/** 每日挑战的「现在」（毫秒时间戳）。 */
export function dailyNow(): number {
  if (hasServerClock()) return serverTime();
  return Date.now() + (headerOffset ?? 0);
}

/** 量一次服务器的钟（一个会话里只量一次；量不到就算了）。 */
export function syncDailyClock(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const t0 = Date.now();
      const res = await fetchWithTimeout('/', { method: 'HEAD', cache: 'no-store' });
      const t1 = Date.now();
      const date = Date.parse(res.headers.get('date') ?? '');
      if (Number.isFinite(date)) headerOffset = date + 500 - (t0 + t1) / 2;
    } catch {
      // 离线、被拦：用本机的钟（见文件头）。
    }
  })();
  return syncing;
}
