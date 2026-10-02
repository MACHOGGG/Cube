/**
 * 「锁开之后每 4 小时一次机会」——这句话从前是假的。
 *
 *   node scripts/check-pin-window.mjs
 *
 * ── 那个漏 ────────────────────────────────────────────────────
 *
 * `_accounts.js` 的 `checkPin` 开头有一句 `if (account.lockUntil > now) return 'locked'`，
 * 判的是**调用方手里那份快照**。它和「把新的 lockUntil 写回去」之间隔着好几次网络往返，
 * 于是同一瞬间打进来的一批请求全都读到「锁已经开了」，全都过了那一关，全都去比对一次。
 *
 * `block: true` 那一支（邮箱账号）还有一道硬闸：`tries > BLOCK_AFTER` 就彻底封，所以最多漏
 * 六次。而 `block: false` 那一支——免邮箱凭据账号（E38，api/handle.js）——**没有任何上闸**：
 * 它压根不走封号那一档（封号只有「拿邮箱证明自己」才解得开，而那种账号没有邮箱）。一次并
 * 发就是一万次比对，锁开一次又是一万次。
 *
 * 要紧的是 `checkPin` 的注释原先写着「换算下来是『锁开之后每 4 小时一次机会』，而第二串是
 * ≥8 位的大小写敏感字母数字（62⁸ ≈ 2.2×10¹⁴）——靠猜连门缝都摸不到」。那个算术只有在「一
 * 次一次来」时才成立。**又一个看着在守的假门，而屏幕上、日志里什么都看不出来。**
 *
 * 2026-10-02 补了一张 SET NX 的票（`pinWinKey`）：过了锁线之后，一个锁期里只有一个请求有资
 * 格真的去比对。
 *
 * ── 怎么量得出来 ──────────────────────────────────────────────
 *
 * 这件事不能看返回值的「对不对」：过了锁线之后，猜错的人和被拦下的人收到的都是 'locked'。
 * 所以反过来——**拿对的那一串去并发**。真有闸时只有一个请求摸得到比对，于是只有一个 'ok'；
 * 闸没了的话五十个全是 'ok'。一个干净的二值观测。
 *
 * ③ 那一节是反方向的尺子：这道闸不许罚到本人。猜对的人要把那张票还回去（`del`），否则他
 * 自己上一次的手误会把他关在外面四小时。
 *
 * 不起服务器、不连 Redis：库用进程内的那份。
 */
process.env.ALLOW_MEMORY_STORE = '1';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

import { readFileSync } from 'node:fs';

const A = await import('../api/_accounts.js');
const { get, del } = await import('../api/_store.js');

/** 免邮箱凭据账号的 id 就长这样（_accounts.js 的 pairKey）。 */
const PAIRLESS = A.pairKey('PinWindowGate1');
const RIGHT = 'rightpass';
const WRONG = 'wrongpass';
const PINWIN = 'pinwin:' + PAIRLESS;
const PINFAIL = 'pinfail:' + PAIRLESS;

await A.createAccount(PAIRLESS, A.newAccount(RIGHT, 'code'));

/** 「四小时过去了」：锁自己开，那张票也自己过期。 */
async function fourHoursLater() {
  await A.updateAccount(PAIRLESS, (a) => {
    a.lockUntil = 0;
  });
  await del(PINWIN);
}

/** 一份「进门时读到的」快照——并发那一批每个请求各拿一份，真实情况就是这样。 */
const snapshot = async () => structuredClone(await A.loadAccount(PAIRLESS));

// ── ① 一次一次来：错 4 次锁上 ──────────────────────────────────
{
  const verdicts = [];
  for (let i = 0; i < 4; i++) {
    verdicts.push(await A.checkPin(PAIRLESS, WRONG, await snapshot(), { block: false }));
  }
  check('① 前 3 次答「不对」', verdicts.slice(0, 3).every((v) => v === 'wrong'), verdicts.join(','));
  check('① 第 4 次锁上', verdicts[3] === 'locked', verdicts[3]);
  check('① 锁着的时候连对的那一串也进不去',
    (await A.checkPin(PAIRLESS, RIGHT, await snapshot(), { block: false })) === 'locked');
  check('① 账号上也记着锁到几点', Number((await A.loadAccount(PAIRLESS)).lockUntil) > Date.now());
  // 头 4 次是写明给出去的预算，所以这时候**还没有**那张票（闸是 `tries > LOCK_AFTER`，
  // 第 4 次不算过线）。④ 那一节专门钉这一条。
  check('① 到这一步还没发过那张票', !(await get(PINWIN)), String(await get(PINWIN)));
}

// ── ①′ 四小时后的第一次：票发出去了 ────────────────────────────
//
// 白盒一条：那张票的键名。`checkPin` 的注释里写的是它，钉住免得哪天改了名字而两边不一致。
{
  await fourHoursLater();
  const v = await A.checkPin(PAIRLESS, WRONG, await snapshot(), { block: false });
  check("①′ 锁开之后错一次，照旧答 locked（那 4 小时重新算）", v === 'locked', v);
  check("①′ 这一次把票发出去了（键名 pinwin:<id>）", Boolean(await get(PINWIN)),
    String(await get(PINWIN)));
  check("①′ 票还在的时候，连对的那一串也摸不到比对",
    (await A.checkPin(PAIRLESS, RIGHT, await snapshot(), { block: false })) === 'locked');
}

// ── ② 四小时后的一次并发：只许一个请求摸到比对 ──────────────────
{
  await fourHoursLater();
  const snaps = await Promise.all(Array.from({ length: 50 }, () => snapshot()));
  const out = await Promise.all(snaps.map((s) => A.checkPin(PAIRLESS, RIGHT, s, { block: false })));
  const oks = out.filter((v) => v === 'ok').length;
  const locked = out.filter((v) => v === 'locked').length;
  check('② 五十个请求同时拿**对的**那一串来，只有一个摸得到比对', oks === 1, `ok ${oks} 个`);
  check('② 另外四十九个被那张票挡下（答 locked，一个字都没写）', locked === 49, `locked ${locked} 个`);
}

// ── ③ 反方向：这道闸不许罚到本人 ───────────────────────────────
{
  // 上面那一个 'ok' 该把票和计数一起还回去。
  check('③ 猜对之后那张票还回去了', !(await get(PINWIN)), String(await get(PINWIN)));
  check('③ 失败计数也清了', !(await get(PINFAIL)), String(await get(PINFAIL)));
  const now = await A.loadAccount(PAIRLESS);
  check('③ 账号上的锁和计数归零', Number(now.lockUntil) === 0 && Number(now.fails) === 0,
    `lockUntil=${now.lockUntil} fails=${now.fails}`);
  check('③ 紧接着再登一次，当场就进得去（不必再等四小时）',
    (await A.checkPin(PAIRLESS, RIGHT, await snapshot(), { block: false })) === 'ok');
}

// ── ④ 锁线**之前**那几次不受影响 ────────────────────────────────
//
// 这一道闸只管「过了锁线之后」。头 4 次是写明给出去的预算，并发四个也该四个都比对得到
// ——不然一个手快的人连输两次就被判成「锁了」，而他才错了两次。
{
  const FRESH = A.pairKey('PinWindowGate2');
  await A.createAccount(FRESH, A.newAccount(RIGHT, 'code'));
  const snaps = await Promise.all(Array.from({ length: 4 }, async () =>
    structuredClone(await A.loadAccount(FRESH))));
  const out = await Promise.all(snaps.map((s) => A.checkPin(FRESH, RIGHT, s, { block: false })));
  check('④ 锁线之前并发四次，四次都比对得到', out.every((v) => v === 'ok'), out.join(','));
  check('④ 而且没发出那张票（它只在过了锁线之后才发）', !(await get('pinwin:' + FRESH)));
}

// ── ⑤ `block: true` 那一支一个字都没变 ─────────────────────────
//
// 邮箱账号有封号那道硬闸，不需要这张票，也不该发给它——发了的话被封的人连「拿邮箱证明
// 自己」之后都要再等四小时。
{
  const MAIL = 'blockside@example.com';
  await A.createAccount(MAIL, A.newAccount(RIGHT, 'card'));
  const seen = [];
  for (let i = 0; i < 7; i++) {
    const snap = structuredClone(await A.loadAccount(MAIL));
    // 锁会在第 4 次之后挡住后面几次，所以每一轮把锁推开，好一路走到封号那一档。
    if (snap.lockUntil) {
      await A.updateAccount(MAIL, (a) => { a.lockUntil = 0; });
      snap.lockUntil = 0;
    }
    // 不传 options：顺手钉住「默认就是会封号的那一档」。
    seen.push(await A.checkPin(MAIL, WRONG, snap));
  }
  check('⑤ 邮箱账号照旧会走到封号那一档', seen.includes('blocked'), seen.join(','));
  check('⑤ 而且从没给它发过那张票', !(await get('pinwin:' + MAIL)), String(await get('pinwin:' + MAIL)));
}

// ── ⑥ 票的有效期必须**就是**锁的时长 ───────────────────────────
//
// 这一条是读源码的，因为没有别的办法：要量出它真的活 4 小时，这道门得等 4 小时。
//
// 写错的后果分两头，而两头都不报错：
//
//   短了（比如随手写个 60 秒）—— 锁还有三小时五十九分，票已经过期了，于是每分钟放一个请
//     求进来比对。那正是这张票要挡的事，而上面 ② 那一节量不出来（它不等）。
//   长了 —— 锁开了票还在，本人要多等一截，而他什么都没做错。
//
// 所以钉的是「这个数是从 LOCK_MS 算出来的」，不是某个字面量。
{
  const src = readFileSync(new URL('../api/_accounts.js', import.meta.url), 'utf8');
  check('⑥ 那张票的 TTL 是由 LOCK_MS 算来的，不是写死的数字',
    /setnx\(\s*pinWinKey\(email\),\s*tries,\s*Math\.floor\(LOCK_MS \/ 1000\)\s*\)/.test(src));
  // 顺手一条：别处不许再自己拼这个键名。
  const uses = (src.match(/'pinwin:'/g) || []).length;
  check('⑥ `pinwin:` 这个前缀只在一处写着（pinWinKey）', uses === 1, `${uses} 处`);
}

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
