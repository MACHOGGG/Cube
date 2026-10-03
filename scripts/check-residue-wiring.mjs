/**
 * 残局穷举兜底的**接线**——五副外边族棋盘各接一遍，一处都不许断。
 *
 *   node scripts/check-residue-wiring.mjs      # 纯 node，读源码，不打包不开浏览器
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这一道单独存在
 *
 * 这条兜底已经有两道门了，可两道守的都是**零件**：
 *
 *   · `check-endgame-residue` —— 搜索件本身（residueSearch.ts）：给定盘面，答得对不对。
 *   · `check-residue-board`   —— 编码层（residueBoard.ts）：喂进去的那副盘面对不对。
 *
 * 没有人守**调用点**。而调用点是同一段话抄了五遍（circle / circleHex / circleSeven /
 * squareDiamond / triangle），这个仓库为「同一件事手写了十六遍」写过一整篇文件头注释
 * （engine/runKey.ts），知道这种东西怎么烂：改一处、漏四处，而且全都不报错。
 *
 * 这一段里**每一行错了都是静默的**，而且错的方向都朝着最贵的那一侧：
 *
 *   ① 计数说死就直接回（`if (counted.length) return counted;`）—— 漏了的话，计数已经
 *      判死的残局还要再穷举一遍；盘子大的时候那是白烧 250ms，掉帧。
 *   ② `live.length > RESIDUE_MAX_TILES` 那道守卫 —— 漏了的话，整盘 28 枚也去 BFS，
 *      20000 态/250ms 的预算每一拍都烧满，手机上直接卡住。
 *   ③ **只有 `'dead'` 才判死** —— 这一条是整段里最要命的：写成 `verdict !== 'scores'`
 *      的话，`'unknown'`（预算用完、算不出来）会被当成死局，**把一局还能打的棋盘 1.4 秒
 *      直接结算**。residueSearch 文件头写得很清楚：「算不完一律当活」。
 *   ④ 三角那一副要多传一个 `true`（只允许偶数步，见 orientationDeal.ts）—— 漏了的话
 *      搜索件在算**另一副棋盘**，而它会言之凿凿地答 'dead'。
 *
 * 外加控制器那一头：判死之后**真的会结算**，而且是 §4 写的那 1.4 秒。
 *
 * ⚠️ 这一道**不是**端到端：它不开浏览器、不真打一局。真正的端到端验收（造一个「计数判
 * 活、几何已死」的 ≤16 枚残局，看它 1.4 秒内结算）还欠着——那一条做不到「发一副牌就
 * 得到」，因为**任何一副刚发的牌都是满盘**（方块 36 枚、小球 28 枚），而这条兜底只在
 * ≤16 枚时才触发。要么给棋盘加一个局中改盘面的注入口，要么靠自检机器人真打到那儿。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');

let fails = 0;
const check = (name, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

/** 接了这条兜底的那几副（外边族）。方块 36 不在里面——见文件末尾那一节。 */
const WIRED = ['circle', 'circleHex', 'circleSeven', 'squareDiamond', 'triangle'];
/** 只有三角要「偶数步」那个开关。 */
const EVEN_ONLY = 'triangle';

const src = Object.fromEntries(WIRED.map((n) => [n, read(`src/shapes/${n}.ts`)]));

// ── ① 尺子：五副都在，而且都真的 import 了那两样 ──────────────────────
for (const name of WIRED) {
  const s = src[name];
  check(`（尺子）${name}.ts 读到了，而且不短`, s.length > 2000, `${s.length} 字`);
  check(`${name}：import 了 RESIDUE_MAX_TILES 和 edgeResidue`,
    /import \{[^}]*RESIDUE_MAX_TILES[^}]*edgeResidue[^}]*\} from '\.\.\/engine\/residueBoard'/.test(s)
    || (/RESIDUE_MAX_TILES/.test(s) && /edgeResidue/.test(s) && /residueBoard/.test(s)),
    '');
}

// ── ② 四行按顺序出现，一行都不许少 ────────────────────────────────────
//
// 按**出现的先后**量，不只是「这几个字串都在」：顺序错了行为就变了。计数那一行要是排
// 在穷举后面，那就成了「每一拍都先 BFS 一遍」；上限守卫排在 edgeResidue 后面，等于没有
// 守卫。
for (const name of WIRED) {
  const s = src[name];
  const at = (re) => {
    const m = s.match(re);
    return m ? m.index : -1;
  };
  const counted = at(/if \(counted\.length\) return counted;/);
  const guard = at(/if \(live\.length > RESIDUE_MAX_TILES\) return \[\];/);
  const call = at(/const verdict = edgeResidue\(/);
  const dead = at(/verdict === 'dead' \? stuckGroupsOf\(live\) : \[\]/);
  check(`${name}：① 计数说死就直接回`, counted >= 0, counted >= 0 ? '' : '没找到那一行');
  check(`${name}：② 可用枚数超上限就不穷举（守卫用的是 >，16 枚本身要算）`,
    guard >= 0, guard >= 0 ? '' : '没找到那道守卫');
  check(`${name}：③ 调了 edgeResidue`, call >= 0, call >= 0 ? '' : '根本没调');
  /*
   * 这一条是整道门的重心。`'unknown'` 是「预算用完、算不出来」，residueSearch 的文件头
   * 写着「调用方一律当活」——写成 `verdict !== 'scores'` 的话它会被当成死局，而那是把一
   * 局还能打的棋盘 1.4 秒直接结算。所以这儿要的是**逐字的 `=== 'dead'`**，不是「某种判
   * 断」。
   */
  check(`${name}：④ 只有 'dead' 才判死（'unknown' 和 'scores' 都当活）`,
    dead >= 0, dead >= 0 ? '' : "没找到 `verdict === 'dead' ? stuckGroupsOf(live) : []`");
  check(`${name}：四行的先后对`, counted >= 0 && guard > counted && call > guard && dead > call,
    `counted@${counted} guard@${guard} call@${call} dead@${dead}`);
  // 反面：这一段里不许出现「不是 scores 就算死」那种写法。
  check(`${name}：没有写成「不是 'scores' 就判死」`,
    !/verdict !== 'scores'/.test(s) && !/verdict != 'scores'/.test(s), '');
}

// ── ③ 三角要「偶数步」，别的四副不要 ──────────────────────────────────
//
// 三角的格子正反交替朝向，所以只允许偶数步（见 engine/orientationDeal.ts 开头那段）。
// 漏掉这个开关，搜索件会去算一副**滑法不同的棋盘**，而它会言之凿凿地答 'dead'。
for (const name of WIRED) {
  const call = src[name].match(/const verdict = edgeResidue\(([^;]*)\);/);
  const args = call ? call[1] : '';
  const even = /,\s*true\s*\)?$/.test(args.trim()) || /,\s*true\s*$/.test(args.trim());
  if (name === EVEN_ONLY) {
    check(`${name}：多传了「只许偶数步」那个开关`, even, args.trim());
  } else {
    check(`${name}：没多传那个开关（它的滑动是普通循环位移）`, !even, args.trim());
  }
}

// ── ④ 控制器那一头：判死之后真的会结算，而且是 §4 那 1.4 秒 ────────────
{
  const gc = read('src/engine/gameController.ts');
  check('（尺子）gameController.ts 读到了', gc.length > 10000, `${gc.length} 字`);
  const m = gc.match(/function updateStuckState\(groups: Cell\[\]\[\]\) \{[\s\S]*?\n  \}/);
  check('（尺子）切出了 updateStuckState', Boolean(m), m ? `${m[0].length} 字` : '没找到');
  if (m) {
    const body = m[0];
    check('判死之后自己结算（不等玩家按键）', /endGame\('无法继续匹配'\)/.test(body), '');
    check('那一下隔着 1400ms（§4 写的 1.4 秒）', /\}, 1400\);/.test(body), '');
    // 先红一下让人看清是什么死了——少了这一句，屏幕上是「突然就结算了」。
    check('结算之前先重画一次（那几枚要先红起来）', /hooks\.render\(\);/.test(body), '');
    // 空集合不许结算：findStuckGroups 回 [] 是「还活着」。
    check('只有报了组才结算（空集合是「还活着」）', /if \(groups\.length && !gameOver\)/.test(body), '');
    // 第 14 推：那 1.4 秒的定时器要撤得掉。原先是一个没人记得的 setTimeout——亮红的那 1.4
    // 秒里按了《再来一局》，它照样响，把**新的那一局**以「无法继续匹配」收掉。
    check('那个定时器记在 stuckTimer 上（撤得掉）', /stuckTimer = window\.setTimeout\(/.test(body), '');
  }
  const newGame = gc.match(/function newGame\(\) \{[\s\S]*?hooks\.resetBoard\(\);/);
  check('新开一局之前先撤掉它（不然会收掉新的那一局）',
    Boolean(newGame) && /window\.clearTimeout\(stuckTimer\)/.test(newGame[0]), newGame ? '' : '没切出 newGame 的开头');
  const destroy = gc.match(/destroy\(\) \{[\s\S]*?\n    \},/);
  check('拆掉这一页时也撤掉它', Boolean(destroy) && /window\.clearTimeout\(stuckTimer\)/.test(destroy[0]),
    destroy ? '' : '没切出 destroy');
  check('棋盘报上来的结果真的喂进了 updateStuckState',
    /updateStuckState\(hooks\.findStuckGroups\?\.\(\) \?\? \[\]\)/.test(gc), '');
}

// ── ⑤ 方块 36 不接这条兜底，这是**有意**的，不是漏了 ────────────────────
//
// 它不是外边族：任意整行整列都能消，没有「最外边」这回事（见 ui/edgeBand.ts），
// `edgeResidue` 那套「线 + 可削外边」的编码在它身上无从谈起。写成一条断言而不是一句注
// 释，是为了让下一个人看见「这是查过的，不是忘了」——哪天有人给方块也接上一条兜底，这
// 一条会红，提醒他回来把这段话改掉。
{
  const sq = read('src/shapes/square.ts');
  check('方块 36 没接 edgeResidue（有意：它不是外边族）',
    !/edgeResidue/.test(sq), '');
  check('（尺子）可方块自己是有计数判活的', /findStuckColorGroups/.test(sq), '');
}

console.log('');
if (fails) {
  console.log(`FAIL ${fails} 条`);
  process.exit(1);
}
console.log('ALL PASS');
