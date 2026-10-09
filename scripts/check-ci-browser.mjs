/**
 * browser 那一条拆片之后的清单（10-09 方案 7-0）：scripts/ci-browser.mjs 的 GATES / SHARDS 自己对、
 * 和 ci.yml 里那个矩阵对得上。
 *
 *   node scripts/check-ci-browser.mjs
 *
 * 纯 node、零点几秒，进 check 那一条。为什么要它：清单写错了——片名打错、端口撞了、门改了名清单没跟上、
 * 矩阵少列了一片——要等 browser 那几片装完浏览器、出完包才炸，或者干脆不炸（矩阵少一片，那几道门就再
 * 也没人跑，CI 照样全绿）。这道门几秒钟就说。
 *
 *   ① 清单本身没毛病（ci-browser.mjs 的 problems()：片名认得、端口不撞、脚本都在、起了服务器就把地址
 *      交给门、要地址就得有服务器、每片至少一道）；
 *   ② ci.yml 里 browser 的矩阵正好是 SHARDS，一片不多一片不少；
 *   ③ browser 那一条跑的就是 `node scripts/ci-browser.mjs ${{ matrix.shard }}`，fail-fast 关着（一片红了
 *      别的片照样跑完）；ci.yml 里不再有哪一步自己起 dev-server——门只在一个地方登记；
 *   ④ 小红书那两道在清单里：check-oldcss 自己一片（方案原话「check-oldcss 单独一片」）、check-oldkernel；
 *   ⑤ 每片按上一次量的时长不超过 15 分钟（方案的目标是整条 CI 十五分钟上下）——加了门、门变慢了，先
 *      在 `node scripts/ci-browser.mjs --list` 里拉平；
 *   ⑥ 拆片之前 ci.yml 里那 49 道（7d38483）一道都没丢：名单写死在下面。真要撤一道，从名单里删掉、
 *      在 RETIRED 里写一句为什么——撤门是一个决定，不该是改清单时手一滑。
 */
import { readFileSync } from 'node:fs';
import { GATES, SHARDS, problems } from './ci-browser.mjs';

let fail = 0;
const check = (n, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// ── ① 清单本身 ─────────────────────────────────────────────────────────────
const bad = problems();
check('① 清单本身没毛病', bad.length === 0, bad.join(' / ') || `${GATES.length} 道 · ${SHARDS.length} 片`);

// ── ② ③ 和 ci.yml 对得上 ────────────────────────────────────────────────────
const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const lines = yml.split('\n');
const at = lines.findIndex((l) => l === '  browser:');
const end = lines.findIndex((l, i) => i > at && /^ {2}[A-Za-z_][\w-]*:\s*$/.test(l));
const browser = lines.slice(at, end < 0 ? lines.length : end).join('\n');
check('（尺子）ci.yml 里找得到 browser 这个 job', at > 0, `第 ${at + 1} 行`);
const matrix = (browser.match(/\n {8}shard: \[([^\]]*)\]/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean);
check('② 矩阵正好是 SHARDS（一片不多一片不少）', matrix.join() === SHARDS.join(), `矩阵 ${matrix.join(' ')} · 清单 ${SHARDS.join(' ')}`);
check('③ 跑的是 node scripts/ci-browser.mjs ${{ matrix.shard }}', /\n {8}run: node scripts\/ci-browser\.mjs \$\{\{ matrix\.shard \}\}\n?/.test(browser + '\n'));
check('③ fail-fast 关着（一片红了别的片照样跑完）', /\n {6}fail-fast: false\n/.test(browser));
const raw = yml.replace(/^\s*#.*$/gm, '');
check('③ ci.yml 里没有哪一步自己起 dev-server（门只在 ci-browser.mjs 一处登记）', !/dev-server\.mjs \d+ dist/.test(raw.slice(raw.indexOf('\n  browser:'))),
  (raw.slice(raw.indexOf('\n  browser:')).match(/dev-server\.mjs \d+ dist/) || ['没有'])[0]);

// ── ④ 小红书那两道 ────────────────────────────────────────────────────────────
const by = (script) => GATES.find((g) => g.run[0] === script);
const oldcss = by('xhs/check-oldcss.mjs');
check('④ check-oldcss 在清单里，而且自己一片', Boolean(oldcss) && GATES.filter((g) => g.shard === oldcss.shard).length === 1,
  oldcss ? `片「${oldcss.shard}」` : '不在');
check('④ check-oldkernel 在清单里', Boolean(by('xhs/check-oldkernel.mjs')));

// ── ⑤ 每片不超过 15 分钟 ─────────────────────────────────────────────────────
const LIMIT = 15 * 60;
const loads = SHARDS.map((s) => [s, GATES.filter((g) => g.shard === s).reduce((n, g) => n + g.secs, 0)]);
const over = loads.filter(([, t]) => t > LIMIT);
check('⑤ 每片按上一次量的时长不超过 15 分钟', over.length === 0, loads.map(([s, t]) => `${s} ${Math.round(t / 60)}′`).join(' · '));

// ── ⑥ 拆片之前那 49 道一道都没丢 ─────────────────────────────────────────────
const BEFORE = [
  'scripts/check-mode-axis.mjs', 'scripts/check-menu.mjs', 'scripts/check-overlap.mjs', 'scripts/check-board-fit.mjs',
  'scripts/check-edge-band.mjs', 'scripts/check-perk-pages.mjs', 'scripts/check-knowhow.mjs', 'scripts/check-rule-art.mjs',
  'scripts/check-howto.mjs', 'scripts/check-creem-review.mjs', 'scripts/check-random-target.mjs', 'scripts/check-room-slot.mjs',
  'scripts/check-room-code.mjs', 'scripts/check-endcard-reach.mjs', 'scripts/check-register-guide.mjs', 'scripts/check-signin-ui.mjs',
  'scripts/check-auth-fit.mjs', 'scripts/check-contact-thanks.mjs', 'scripts/check-bomb-panel.mjs', 'scripts/check-game-desktop.mjs',
  'scripts/check-records-desktop.mjs', 'xhs/check-oldcss.mjs', 'scripts/check-coach-aim.mjs', 'scripts/check-new-version.mjs',
  'scripts/check-redesign-fit.mjs', 'scripts/check-mint-rebuild.mjs', 'scripts/check-nickname-head.mjs', 'scripts/check-page-exit.mjs',
  'scripts/check-records-rows.mjs', 'scripts/check-total-card.mjs', 'scripts/check-count-stage.mjs', 'scripts/check-mode-icons.mjs',
  'scripts/check-smooth-touch.mjs', 'scripts/check-end-design.mjs', 'scripts/check-title-lines.mjs', 'scripts/check-axis-overlay.mjs',
  'scripts/check-seed-deal.mjs', 'scripts/check-daily.mjs', 'scripts/check-share-seed.mjs', 'scripts/check-host-gone-card.mjs',
  'scripts/check-no-storage.mjs', 'scripts/check-hex-hole.mjs', 'scripts/check-room-force-ui.mjs', 'scripts/check-disband-retry.mjs',
  'scripts/check-rank-network.mjs', 'scripts/check-room-knows.mjs', 'scripts/check-daily-note.mjs', 'scripts/check-square-fullturn.mjs',
  'scripts/check-room-pick-tap.mjs',
];
/** 撤下来的门 → 为什么。撤一道，就从上面删掉、在这儿写一句。 */
const RETIRED = {};
const listed = new Set(GATES.map((g) => g.run[0]));
const lost = BEFORE.filter((s) => !listed.has(s) && !RETIRED[s]);
check('（尺子）拆片之前那份名单是 49 道', BEFORE.length + Object.keys(RETIRED).length === 49, `${BEFORE.length} + 撤下 ${Object.keys(RETIRED).length}`);
check('⑥ 拆片之前 ci.yml 里那几道一道都没丢', lost.length === 0, lost.join(' ') || `${BEFORE.length} 道都在`);

console.log(fail ? `\n${fail} 条红` : '\n全绿');
process.exit(fail ? 1 : 0);
