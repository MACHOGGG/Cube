/**
 * 从 Creem 结账页回来的那一下，四种情形。
 *
 *   node scripts/check-checkout-return.mjs http://localhost:8830/
 *
 * 要守住的东西只有一件：买家付过的那笔钱，凭证不能丢。checkout id 只在 Creem
 * 把人送回来的那一次出现在地址栏里，一旦被清掉就再也拿不回来——所以它必须在
 * 「问服务器这笔成没成」之前就落到硬盘上，而不是之后。
 *
 * 同时要守住反面：记下 id 不等于有人付过钱（地址栏里随手拼一个也能留下一
 * 个），而刷卡那扇设密码的窗是关不掉的。所以「弹窗」的前提必须是真的有权益，
 * 不能是「有个 id」。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

/**
 * 开一个上下文，把 /api/subscription 换成我们自己的回答。
 * `reply` 为 null 表示「请求根本没到达」（断网）。
 */
async function visit({ query = '', reply, storage = null }) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(
    ([saved]) => {
      for (const k of ['slides_tutorial_seen', 'slides_tutorial_seen_circle', 'slides_tutorial_seen_triangle'])
        localStorage.setItem(k, '1');
      localStorage.setItem('slides_lang', 'zhHans');
      if (saved) for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    },
    [storage],
  );
  // 顺序要紧：Playwright 里后注册的 route 先匹配，所以兜底要先注册，具体的
  // 那条后注册，否则 /api/subscription 会被兜底吃掉。
  await ctx.route('**/api/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"notConfigured"}' }),
  );
  await ctx.route('**/api/subscription', (route) => {
    if (reply === null) return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });

  const page = await ctx.newPage();
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForSelector('#navProfile', { timeout: 25000 });
  // 开机那几步（settle、可能弹窗）跑完
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    genius: localStorage.getItem('slides_genius'),
    pending: localStorage.getItem('slides_pending_account'),
    url: location.href,
    pwWindow: Boolean(document.querySelector('#pwGo')),
    // 关不掉的窗：点遮罩之后还在
    overlays: document.querySelectorAll('.overlay.show').length,
  }));
  return { ctx, page, state };
}

const ACTIVE = { active: true, period: 'monthly', until: Date.now() + 30 * 86400000, email: 'buyer@test.com' };

// ── 1. 正常付款回来 ──────────────────────────────────────────────────
{
  const { ctx, state } = await visit({ query: '?checkout_id=chk_ok', reply: ACTIVE });
  check('付款成功：权益写下了', Boolean(state.genius && JSON.parse(state.genius).active));
  check('付款成功：checkout id 记下了', state.pending?.includes('chk_ok') === true, state.pending || '(空)');
  check('付款成功：地址栏清干净了', !state.url.includes('checkout_id'), state.url);
  check('付款成功：弹出设密码窗', state.pwWindow);
  await ctx.close();
}

// ── 2. 付了钱，但那一次请求没成（这一条就是修的东西）────────────────
let carried = null;
{
  const { ctx, state } = await visit({ query: '?checkout_id=chk_flaky', reply: null });
  check('请求失败：凭证仍然保住了', state.pending?.includes('chk_flaky') === true, state.pending || '(丢了！)');
  check('请求失败：地址栏照样清掉（不会重复结算）', !state.url.includes('checkout_id'));
  check('请求失败：没有权益就不弹那扇关不掉的窗', !state.pwWindow);
  carried = { slides_pending_account: state.pending };
  await ctx.close();
}

// ── 3. 下次启动，服务器这次答上来了 ──────────────────────────────────
{
  const { ctx, state } = await visit({ query: '', reply: ACTIVE, storage: carried });
  check('下次启动：拿着记下的 id 重试并成功', Boolean(state.genius && JSON.parse(state.genius).active));
  check('下次启动：这时才弹设密码窗', state.pwWindow);
  await ctx.close();
}

// ── 4. 地址栏里随手拼一个 id ─────────────────────────────────────────
{
  const { ctx, page, state } = await visit({
    query: '?checkout_id=chk_bogus',
    reply: { active: false },
  });
  check('伪造 id：不发权益', !state.genius || !JSON.parse(state.genius).active);
  check('伪造 id：不弹那扇关不掉的窗', !state.pwWindow, `窗口数 ${state.overlays}`);
  // 再确认一次真的没被锁住：还能正常点进个人主页
  await page.click('#navProfile');
  const reachable = await page.waitForSelector('#becomeGeniusBtn', { timeout: 8000 }).catch(() => null);
  check('伪造 id：应用没被锁住，还能正常用', Boolean(reachable));
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail ? 1 : 0);
