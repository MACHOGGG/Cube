/**
 * Asks the Redis behind the app three questions worth knowing before any
 * real player has an account in it:
 *
 *   node scripts/check-store.mjs
 *
 *   1. Is anything configured at all, and can we reach it.
 *   2. Will it throw data away when it fills up — and if so, would it throw
 *      away the data that matters. Accounts and unspent redeem codes are
 *      written with no expiry; rooms and unlock codes are written with one.
 *      Every `volatile-*` policy may only evict keys that have an expiry, so
 *      under those the disposable half is sacrificed and the permanent half
 *      is untouchable. Only `allkeys-*` can take an account.
 *   3. What is actually in there right now, and which of it has an expiry —
 *      measured rather than assumed, because the guarantee above is only
 *      worth anything if our own keys really are written the way we think.
 *
 * Reads the same two environment variables the app does. Nothing is written
 * except one probe key, which is deleted before this exits.
 */
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

if (!url || !token) {
  console.error('没有配置存储：请设置 KV_REST_API_URL 和 KV_REST_API_TOKEN。');
  console.error('（在 Vercel 上这两个由 Upstash 集成自动注入；本地跑就从 Vercel 后台复制过来。）');
  process.exit(1);
}

async function redis(...args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body.result;
}

const SAFE = new Set(['noeviction', 'volatile-lru', 'volatile-lfu', 'volatile-random', 'volatile-ttl']);

console.log('连接 :', new URL(url).host);
console.log('键总数:', await redis('DBSIZE'));

// ── 淘汰策略 ────────────────────────────────────────────────────────────
let policy = null;
try {
  const conf = await redis('CONFIG', 'GET', 'maxmemory-policy');
  policy = Array.isArray(conf) ? conf[1] : null;
} catch {
  // Managed Redis often refuses CONFIG. Not a failure — just unknown here.
}
if (!policy) {
  console.log('\n淘汰策略: 这台服务器不允许通过命令查询（多数托管 Redis 都禁用 CONFIG）。');
  console.log('          请到 Upstash 后台看数据库详情里的 Eviction 开关，应为关闭。');
} else if (SAFE.has(policy)) {
  console.log(`\n淘汰策略: ${policy} ✅ 安全`);
  console.log(policy === 'noeviction'
    ? '          满了就拒绝写入，任何数据都不会被自动删掉。'
    : '          只会淘汰设了过期时间的 key —— 也就是房间和验证码，账号和内部码碰不到。');
} else {
  console.log(`\n淘汰策略: ${policy} ⚠️ 危险`);
  console.log('          allkeys-* 表示内存满了会删任意 key，包括玩家账号。请到 Upstash');
  console.log('          后台关掉 Eviction，或换成 noeviction / volatile-lru。');
}

// ── 我们自己的 key 到底有没有过期时间 ──────────────────────────────────
const probe = 'probe:check-store:' + Date.now();
await redis('SET', probe, '1');
const probeTtl = await redis('TTL', probe);
await redis('DEL', probe);
console.log(`\n探针: 不带过期时间写入的 key，TTL = ${probeTtl}（-1 表示永不过期，符合预期）`);

const GROUPS = [
  ['acct:*', '玩家账号', false],
  ['code:*', '未使用的内部码', false],
  ['codeused:*', '已兑换记录', false],
  ['room:*', '多人房间', true],
  ['unlock:*', '解锁验证码', true],
];
console.log('\n现有数据:');
for (const [pattern, label, shouldExpire] of GROUPS) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis('SCAN', cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0' && keys.length < 5000);

  if (!keys.length) {
    console.log(`  ${label.padEnd(8)} 0 条`);
    continue;
  }
  const ttls = await Promise.all(keys.slice(0, 50).map((k) => redis('TTL', k)));
  const withTtl = ttls.filter((t) => t > 0).length;
  const ok = shouldExpire ? withTtl === ttls.length : withTtl === 0;
  console.log(
    `  ${label.padEnd(8)} ${String(keys.length).padStart(5)} 条  ` +
      `${withTtl}/${ttls.length} 带过期时间  ` +
      `${ok ? '✅ 符合预期' : '⚠️ 与预期不符'}`,
  );
}
