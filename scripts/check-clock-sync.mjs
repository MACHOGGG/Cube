/**
 * 小屋倒数的钟：偏差怎么估、倒数数字会不会往回跳（第 14 推）。
 *
 *   npx esbuild src/engine/clockSync.ts --bundle --format=esm --outfile=/tmp/clocksync.mjs
 *   node scripts/check-clock-sync.mjs /tmp/clocksync.mjs
 *
 * 纯函数，喂的是模拟回包：一份回包就是「本机 t0 发出、服务器在 t0 + 上行 那一刻盖章、本机
 * 在 t0 + 上行 + 下行 那一刻收到」。真实的偏差是已知的，所以估得准不准可以直接量。
 *
 * 要守的三件事：
 *
 *   ① 一个样本的误差最多半个往返（`stamp − (t0+t1)/2`）——原先 `stamp − t1` 的误差是整段
 *      下行，而且永远偏同一边。
 *   ② 只留往返最短的那一个：一份走得慢的回包不许把钟拨走。
 *   ③ 倒数数字只减不增——哪怕估出来的钟真的往回挪了一下。
 *
 * 每一条都带一把「原先那样会怎样」的尺子：同一组回包喂给原先的写法，它真的会估歪 / 真的会
 * 往回跳。少了这把尺子，「没往回跳」在「模拟的那几份回包根本挪不动钟」的时候也会绿。
 */
const src = process.argv[2];
if (!src) {
  console.error('用法: node scripts/check-clock-sync.mjs /tmp/clocksync.mjs');
  process.exit(2);
}
const { clockSample, keepBetter, countdownDigit } = await import(src);

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

const TRUE_OFFSET = 5000; // 服务器比本机快 5 秒
/** 一份模拟回包：本机 t0 发出，上行 up、下行 down 毫秒。 */
const reply = (t0, up, down) => ({ t0, stamp: t0 + up + TRUE_OFFSET, t1: t0 + up + down });
/** 原先那种写法：stamp − 收到那一刻。 */
const oldOffset = (r) => r.stamp - r.t1;

// ── ① 一个样本的误差 ──────────────────────────────────────────
{
  const sym = reply(1000, 150, 150);
  const s = clockSample(sym.stamp, sym.t0, sym.t1);
  check('① 上下行一样长：估得一点不差', s.offset === TRUE_OFFSET, `${s.offset}`);
  check('① （尺子）原先那种写法同一份回包差了整段下行', TRUE_OFFSET - oldOffset(sym) === 150, `${TRUE_OFFSET - oldOffset(sym)}`);
  check('① 往返记对了', s.rtt === 300, String(s.rtt));
  let worst = 0;
  for (let up = 0; up <= 400; up += 25) {
    for (let down = 0; down <= 400; down += 25) {
      const r = reply(0, up, down);
      const e = Math.abs(clockSample(r.stamp, r.t0, r.t1).offset - TRUE_OFFSET);
      worst = Math.max(worst, e - (up + down) / 2);
    }
  }
  check('① 上下行怎么不对称，误差都不超过半个往返', worst <= 0, `最多超出 ${worst}ms`);
}

// ── ② 只留往返最短的那一个 ───────────────────────────────────
{
  // 第二份走得快（往返 40），后面那份走得很慢、还很不对称（上行 50、下行 850）。
  const replies = [reply(0, 150, 150), reply(1000, 20, 20), reply(2000, 50, 850), reply(3000, 200, 100)];
  let best = null;
  const trail = [];
  for (const r of replies) {
    best = keepBetter(best, clockSample(r.stamp, r.t0, r.t1));
    trail.push(best.offset);
  }
  check('② 留下的是往返 40 的那一个', best.rtt === 40, `rtt ${best.rtt}`);
  check('② 估出来的钟就是真的那个', best.offset === TRUE_OFFSET, String(best.offset));
  check('② 慢的那一份没把钟拨走（第三份之后还是 5000）', trail[2] === TRUE_OFFSET && trail[3] === TRUE_OFFSET, trail.join(' / '));
  const oldTrail = replies.map(oldOffset);
  check('② （尺子）原先那种写法：慢的那一份一来，钟就被拨回 850ms',
    TRUE_OFFSET - oldTrail[2] === 850, oldTrail.join(' / '));
  const tie = keepBetter({ offset: 1, rtt: 40 }, { offset: 2, rtt: 40 });
  check('② 一样短就换新的那一个', tie.offset === 2, JSON.stringify(tie));
}

// ── ③ 倒数数字只减不增 ───────────────────────────────────────
{
  // 一局从 4 数起，开赛在服务器时间 10 000 + 4 500。本机每 80ms 刷一拍；第 2 秒上下来了一份
  // 走得很慢的回包。
  const FIRST = 4;
  const startAt = 10_000 + 4_500;
  const replies = [reply(10_000 - TRUE_OFFSET - 300, 30, 30), reply(10_000 - TRUE_OFFSET + 1_900, 40, 900)];
  const run = (useNew, list = replies) => {
    const replies = list;
    let best = null;
    let offset = 0;
    let shown = 0;
    const digits = [];
    const raw = [];
    let next = 0;
    for (let local = 10_000 - TRUE_OFFSET - 300; local < 10_000 - TRUE_OFFSET + 4_500; local += 80) {
      // 收到回包的那一拍改钟。
      while (next < replies.length && replies[next].t1 <= local) {
        const r = replies[next++];
        if (useNew) {
          best = keepBetter(best, clockSample(r.stamp, r.t0, r.t1));
          offset = best.offset;
        } else {
          offset = oldOffset(r);
        }
      }
      if (next === 0) continue;
      const left = startAt - (local + offset);
      if (left <= 0) break;
      const r = Math.ceil(left / 1000);
      raw.push(r);
      const n = useNew ? countdownDigit(shown, r, FIRST) : Math.min(FIRST, r);
      if (n !== shown) {
        shown = n;
        digits.push(n);
      }
    }
    return { digits, raw };
  };
  const goesUp = (list) => list.some((d, i) => i > 0 && d > list[i - 1]);
  const old = run(false);
  check('③ （尺子）原先那种写法真的往回跳了', goesUp(old.digits), old.digits.join(' '));
  const now = run(true);
  check('③ 现在的数字一路往下，没有往回跳', !goesUp(now.digits), now.digits.join(' '));
  check('③ 而且从 4 数到 1，一个不少', now.digits.join(' ') === '4 3 2 1', now.digits.join(' '));

  // 新的写法也会把钟往回挪——当一份**更准**的回包到了的时候：头一份往返 400、而且全花在上行
  // 上（估出来的钟快了 200ms）。按这只快了的钟，本机 7340 那一拍数字刚翻到 2；7400 来了一份
  // 往返 20 的，钟往回拨 200ms，7420 那一拍算出来又是 3。这一拨是对的（钟本来就该慢 200ms），
  // 可数字不该因此往回跳。
  const skewed = [reply(10_000 - TRUE_OFFSET - 500, 400, 0), reply(10_000 - TRUE_OFFSET + 2_380, 10, 10)];
  const fix = run(true, skewed);
  check('③ （尺子）这一下真的把算出来的秒数往回推了一格', goesUp(fix.raw), fix.raw.filter((v, i, a) => i === 0 || v !== a[i - 1]).join(' '));
  check('③ 数字照样一路往下', !goesUp(fix.digits), fix.digits.join(' '));

  // countdownDigit 自己：就算估出来的秒数真的变大，也亮着上一拍那个。
  check('③ 上一拍是 2，这一拍算出 3：还亮 2', countdownDigit(2, 3, 4) === 2);
  check('③ 头一拍：按算出来的、但不超过从几数起', countdownDigit(0, 9, 4) === 4 && countdownDigit(0, 3, 4) === 3);
  check('③ 往下走照常走', countdownDigit(3, 2, 4) === 2);
}

console.log(fail ? `\n${fail} 条没过` : '\n全部通过');
process.exit(fail ? 1 : 0);
