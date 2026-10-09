/**
 * CI 的 browser 那一条：要开真浏览器的门，分几片并行跑（2026-10-09 方案 7-0）。
 *
 *   node scripts/ci-browser.mjs <片>                 # CI 的矩阵里每一格跑一片（片名见 SHARDS）
 *   node scripts/ci-browser.mjs all                  # 本地一口气全跑，一个小时上下（先 npm run build）
 *   node scripts/ci-browser.mjs <片|all> <关键字>     # 只跑名字或脚本名里带这个关键字的那几道
 *   node scripts/ci-browser.mjs --list               # 每片几道、按上一次量的时长要跑多久
 *
 * ── 为什么拆片 ──────────────────────────────────────────────────────────────────
 *
 * 原先 ci.yml 里一条 browser job 把五十来道门一道接一道串着跑，2026-10-08 一次六十三到七十分钟；
 * promote 要等它绿了才把这一版推进 production，推一次就要干等一个多小时，最后一定有人想跳过它。
 * 这些门本来就互不相干——一门一台 dev-server、一人一个端口（见下面），谁先谁后、跟谁一台机器都不
 * 改结果——所以拆成几片在几台 runner 上同时跑。最长的两道各自一片（「同一种子同一副牌」七百来秒、
 * 小红书降级层六百来秒），其余按上一次量的时长均摊进几片，每片十二分钟上下，加上装浏览器、出包，
 * 整条 CI 十五分钟上下。
 *
 * 门的清单、每一道为什么在这儿，都写在这个文件里（原先写在 ci.yml 每一步上面，一起搬过来了）；
 * ci.yml 只管「几片、每片怎么搭环境」。SHARDS 和 ci.yml 的矩阵对得上、端口不撞、每道门的脚本都在，
 * 由 scripts/check-ci-browser.mjs 在 check 那一条里先验——这个文件写错了，要等几分钟后 browser
 * 开跑才知道，那道门几秒钟就说。
 *
 * ── 一门一台服务器、一人一个端口 ──────────────────────────────────────────────────
 *
 * CLAUDE.md 记着「兑换码在一个 dev-server 进程里只能用一次」：两道都要兑码的门跑在同一台服务器
 * 上，后跑的那道会莫名其妙红。所以哪怕这一道不兑码，也照这条规矩摆，往后加要兑码的门不用回来改结
 * 构。端口撞了会让第二台起不来、门打到前一台上去——check-ci-browser 拦着。
 *
 * ── 起、等、关 ─────────────────────────────────────────────────────────────────
 *
 *   · 起：node scripts/dev-server.mjs <端口> dist，输出丢掉——不让它占着这一步的输出（在 ci.yml
 *     里那样写的时候，前台的门跑完了这一步也可能还在等它，本地试的时候就那么挂住过）。
 *   · 等：每 250 毫秒问一次 /，最多三十秒，**不盲等一个固定秒数**：CI 的机器冷启动比本地慢，盲
 *     等出来的是偶发红，而偶发红最后一定会被人加 continue-on-error。探的是 /，不是哪个接口——接口会
 *     删（check 那一条探过 /api/slots，名额删了以后它永远 404，整步红了一个多月没人发现）。
 *   · 关：这一道跑完就按 PID 关掉它那一台。**不用 pkill -f**：那会连跑门的这个进程和它的 shell
 *     一起杀掉（exit 144）。
 *
 * ── 一道红了不停 ─────────────────────────────────────────────────────────────────
 *
 * 一片里的门全跑完再报哪几道红。原先在 ci.yml 里一步一道，一道红了后面全被跳过——一次只看得见一
 * 条红，修好推上去再等一个小时，才看见下一条。每一道单独限时（默认 20 分钟），卡死的那一道不会把
 * 整片拖到 job 的超时。
 *
 * secs 是 2026-10-08 那一次（7d38483）在 GitHub 上量的每道门的时长，只用来分片和 --list 估时，
 * 不参与判定。门变慢了、加了新门，看 --list 把各片拉平。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** run 里写这个，就换成这一道自己那台服务器的地址。 */
export const SERVER = '<server>';
const RULE_ART = join(tmpdir(), 'ci-browser-ruleart.mjs');

/** 片名。和 ci.yml 里 browser 那个矩阵的 shard 一一对应（check-ci-browser 量）。 */
export const SHARDS = ['a', 'b', 'c', 'd', 'e', 'seed-deal', 'oldcss'];

export const GATES = [
  // 最早收进 CI 的四道（下面这一组），都是当时真的拦下过回归的。
  //
  // 主菜单那条鱼眼轴。第 9 节那五条断言是为「炸弹那张图被撑开」补的（玩家报过两轮、修好过一
  // 次、又回来过）。
  {
    name: '主菜单：鱼眼轴',
    shard: 'b', secs: 216, port: 8811,
    run: ['scripts/check-mode-axis.mjs', SERVER],
  },

  // 换回鱼眼轴那天起它就一直崩在等 .mode-strip 上，**后面 39 条一条都没跑过**，而整个进程还是
  // exit 0，看着像跑完了。
  {
    name: '主菜单：摆了什么、什么次序、点一下开哪儿',
    shard: 'c', secs: 64, port: 8812,
    run: ['scripts/check-menu.mjs', SERVER],
  },

  // 同一族遗留；它还管「有没有东西永远够不着」。
  {
    name: '有没有东西被压住、够不着',
    shard: 'a', secs: 426, port: 8813,
    run: ['scripts/check-overlap.mjs', SERVER],
  },

  // 棋子戳出底板（七色圆球余量为 0 那件事）。
  {
    name: '棋子都在底板里',
    shard: 'c', secs: 197, port: 8814,
    run: ['scripts/check-board-fit.mjs', SERVER],
  },

  // 外边指引那条带子（§PR-7）：五副外边族画、方块 36 不画、在棋子**之下**、
  // 只动明度不动色相。它是这一版唯一一处「盘面现在什么样」的视觉提示，而它能
  // 坏的四种样子都不报错。一门一台服务器、一人一个端口。
  {
    name: '外边指引：双色托盘',
    shard: 'c', secs: 31, port: 8819,
    run: ['scripts/check-edge-band.mjs', SERVER],
  },

  // 下面这三道，和最早那四道是同一轮（1be498a）修好的——那一轮一口气修了五道
  // 崩在选择器上、崩了还 exit 0 的门，可只有 check-menu / check-overlap 两道进了
  // CI。另外三道为什么没进，当时没写；重新看过一遍，没有理由不收：都只要一台
  // dev-server、端口本来就各不相同，也都不带先前就存在的红。（那时小红书那几道
  // 还没收：check-oldcss 带着一条横屏红。后来那一条修掉了，它和 check-oldkernel
  // 都收进来了，见下面 oldcss 那一片和「老内核」那一道。）
  {
    name: '天才特供那几页',
    shard: 'd', secs: 38, port: 8815,
    run: ['scripts/check-perk-pages.mjs', SERVER],
  },

  // 新手拦截底下那颗《我会玩》：按下去立刻跳过引导，但**每个玩法头一回进去自带
  // 的教学照旧**。第二条最容易被顺手做掉（把跳过实现成「所有 firstTimeIn 都记成
  // 看过」就一次性把教学条也关了，不报错、不白屏，只是新人从此没人教）。
  // 只喂网页那一端：小红书那一半要先出预览页（npm run preview:xhs），那是另一
  // 条路，手跑的时候带上第三个参数就连着验。
  {
    name: '《我会玩》跳过引导，但不跳过教学',
    shard: 'b', secs: 15, port: 8953,
    run: ['scripts/check-knowhow.mjs', SERVER],
  },

  // 教学那五条的配图（ui/ruleArt.ts）。要 Chromium，但**不要服务器**——它自己
  // setContent 一页出来，把 CSS 动画的时间轴拨到指定那一刻再量，几秒钟就完。
  //
  // 收它是因为这五幅图是玩家学规矩的地方，而它坏掉不报错：一段 CSS 动画照样跑
  // 得好好的，只是教的规矩是错的。2026-09 教学从六条改成五条，五幅图整体重排，
  // 下标错一个就会「第 3 条配上第 2 条那幅画」——屏幕上看不出是错位。
  {
    name: '教学五条的配图',
    shard: 'c', secs: 1,
    pre: [['npx', 'esbuild', 'src/ui/ruleArt.ts', '--bundle', '--format=esm', `--outfile=${RULE_ART}`]],
    run: ['scripts/check-rule-art.mjs', RULE_ART],
  },

  // 暂停里那颗《怎么玩》：每个玩法只讲自己那一局的事，五条的用词和条数都钉死。
  // 它要兑一张 TESTMONTH，所以必须**一台自己的服务器**（一个 dev-server 进程里
  // 一张码只兑得动一次，两道门共用一台，后跑的那道会莫名其妙红）。
  {
    name: '《怎么玩》那一屏',
    shard: 'a', secs: 53, port: 8941,
    run: ['scripts/check-howto.mjs', SERVER],
  },

  // 收单方审核会照着网站上的陈述逐条核——「网站陈述与实际不符」被直接归为 false
  // information，比缺一份文档严重。这一道就是那份自查：五张法务静态页、价格、
  // 订阅入口，按审核看得到的样子走一遍。
  {
    name: '收单方审核看得到的那几页',
    shard: 'e', secs: 11, port: 8818,
    run: ['scripts/check-creem-review.mjs', SERVER],
  },

  // 老虎机这一条线（《侵蚀阶梯》v1.2 PR-8：一局只认**一个**得分目标）。
  //
  // 两道一起收，因为它们各守这条线的一半，而且都刚从「假绿」里捞出来：两道原先
  // 读的都是棋盘上方那条得分图示带，而 PR-7 把那条带子退役了——读到的是空集合，
  // 于是「盘上认的就是转出来的」变成「空等于空」，一直绿着。现在读的是 HUD 右边
  // 那一块《得分图案》，并且各带一条尺子（那一块必须真的画出了东西、必须挂着只有
  // 老虎机局才有的身份类），空过就红。
  //
  //   · check-random-target —— 单人那一条：挑图形 → 两个滚筒从左到右先后停在同一
  //     张上 → 倒数 → 开局，HUD 那一块画的必须正是轮子上停下来的那一个。
  //   · check-room-slot     —— 小屋那一条：《相同》全屋同一个图案，《不同》各转各
  //     的，而两档都要「每台设备认的正是它自己那台机器上停下来的那一个」。'own'
  //     全靠这一条：少了它，棋盘那边会用本机的 Math.random 再抽一次，玩家眼睁睁
  //     看着轮子停在 A、进去要凑的却是 B。
  //
  // **check-room-slot 必须一台自己的服务器**：它兑一张 TESTMONTH，而一个
  // dev-server 进程里一张码只兑得动一次（CLAUDE.md 那四个坑里的第一个）。
  {
    name: '老虎机：转出来的那一个真的到了盘上',
    shard: 'e', secs: 44, port: 8861,
    run: ['scripts/check-random-target.mjs', SERVER],
  },

  {
    name: '老虎机：小屋里的《相同 / 不同》',
    shard: 'b', secs: 24, port: 8862,
    run: ['scripts/check-room-slot.mjs', SERVER],
  },

  // 屋号那四格（PR-19 / E19）。四位打满是**直接进屋**的，没有《加入》那颗键——所以
  // 「我按下去了」这一下的回执只长在这四格上：还剩几位（空格的下横线）、下一下落在
  // 哪儿（闪烁的光标条）、打错了（抖 ＋ 每格一圈红）、打对了（每格一圈绿逐格画）。
  //
  // 收它是因为它当场拦下了一个「写了等于没写」：进屋那一下是 innerHTML 整片换掉，
  // 绿框如果不等它画完就换页，四圈和换页在**同一拍**里发生，一帧都画不出来——代码
  // 里明明有、屏幕上永远看不见，而且不报任何错。这道门在换页之前截一帧来量。
  //
  // **一台自己的服务器**：它开一间真屋（兑一张 TESTMONTH），而一个 dev-server 进程
  // 里一张码只兑得动一次。
  {
    name: '屋号四格：横线、光标、打错、打对',
    shard: 'c', secs: 14, port: 8863,
    run: ['scripts/check-room-code.mjs', SERVER],
  },

  // 两件「打不开 / 按不到」：《步步为营》整档进不去（gameShell 那个三目不画
  // #scoreReel，而 req() 取不到就抛——棋盘一枚不画，控制台一句错，玩家看到的是
  // 「这个玩法打不开」）；结算页那三颗键在矮屏上够不着（id 选择器那条
  // `overflow: hidden` 简写压掉了 `overflow-y: auto`，320×568 打完一局卡死）。
  // **一台自己的服务器**：它兑一张 TESTMONTH 开《步步为营》。
  {
    name: '步步为营打得开、结算页那三颗键够得着',
    shard: 'b', secs: 51, port: 8865,
    run: ['scripts/check-endcard-reach.mjs', SERVER],
  },

  // 停售期间那一屏：引导到注册，而且**服务端说得出才说**。最容易出的事不是排版，是
  // 印出一句兑现不了的话——授予窗口还没打开、名额已经满了、服务端只回了半份答复，
  // 屏幕上却已经写着「注册就解锁」。各种答复用路由拦截喂一遍（真实那一路由第 ① 节
  // 守着，它走的是服务器自己的答复）。
  {
    name: '停售期：注册引导，服务端说得出才说',
    shard: 'e', secs: 17, port: 8866,
    run: ['scripts/check-register-guide.mjs', SERVER],
  },

  // 《注册 / 登录》那扇窗的三态（E37/E38）。真开浏览器，因为要守的全是「点下去之后变
  // 成什么样」：三态切换、六格、那句「第一串别告诉任何人」在不在、mailDown 时停在哪一
  // 屏、免邮箱账号的《账户》窗第一格是《绑定邮箱》（10-09 补充方案 7-8；那扇窗、绑好之后本机
  // 认成邮箱账号也走一遍，要码验码两问用路由拦截），以及两档屏幕上底排键都在屏内。
  //
  // ⚠️ 服务器**故意不配 Resend**：要码那一步于是必然答 mailDown，而那正是 E51 要守的
  // 那一支——顺便让这道门不依赖任何外部服务。免邮箱那条路不发信，所以它能一路走到真
  // 注册出一个账号。
  {
    name: '注册 / 登录那扇窗的三态',
    shard: 'd', secs: 25, port: 8834, env: { GENIUS_GRANT_WINDOW: '1' },
    run: ['scripts/check-signin-ui.mjs', SERVER],
  },

  // 同一扇窗的**排版和字**，四种语言 × 两档屏幕各走一遍。上面那一道只跑简体中文、只跑
  // 一档屏，而这扇窗里最长的几句话都在法语里：标签是绝对定位的，长了会直接伸出框去；
  // 占位提示长了会被浏览器从中间截断，玩家看到的是半句话。两样都不报错。
  {
    name: '注册 / 登录那扇窗装得下',
    shard: 'a', secs: 38, port: 8836, env: { GENIUS_GRANT_WINDOW: '1' },
    run: ['scripts/check-auth-fit.mjs', SERVER],
  },

  // 《联系与特别感谢》那扇窗（E42）。个人主页底部从五行法务收成两行，这一扇是第二
  // 行。要开浏览器：点得开、玩家自己写的那一段逐字在、邮箱是 mailto 而且和
  // CONTACT_EMAIL 那个常量一致、名字数对得上 src/thanks.ts。
  {
    name: '联系与特别感谢那扇窗',
    shard: 'a', secs: 10, port: 8873,
    run: ['scripts/check-contact-thanks.mjs', SERVER],
  },

  // 炸弹那一页：三行、一行两枚、一点就开（PR-20 / E17+E26）。要开浏览器——三档靠颜色
  // 和徽记分开，而「颜色」和「点一下有没有反应」都只在跑起来之后才量得到。
  //
  // 最要紧的一条是**逐枚点进去**：只量「有六枚」的话，中间那一层回到「点一下才换成两
  // 枚」那个老写法照样绿（那一版屏幕上也是三行，只是中间那行点下去不开局）。
  {
    name: '炸弹那一页',
    shard: 'c', secs: 111, port: 8876,
    run: ['scripts/check-bomb-panel.mjs', SERVER],
  },

  // 电脑端游戏页的五块牌（玩家 2026-10 那张效果图）：各在哪儿、多大、什么色。
  //
  // 收它是因为这一页全靠一张栅格摆着，而栅格最爱做的一件事是**把没安排的东西塞进
  // 第一个空格子**——计时那颗药丸就这么在左上角待过一版（量出来 14, 96），而
  // PR-7 说的是「暂停药丸正上方」。这种错不崩、不报错，只是摆错了地方。
  // 「上下居中」也一样容易被一条不对称的留白悄悄破坏。
  //
  // 最后一节是反面尺子：**手机端一个像素都不许跟着变**（玩家这一轮改的是电脑端）。
  {
    name: '电脑端游戏页：五块牌的位置、大小、色',
    shard: 'e', secs: 21, port: 8864,
    run: ['scripts/check-game-desktop.mjs', SERVER],
  },

  // 电脑端的成绩页三栏（PR-18 / E27）。要开浏览器——整条都是「摆在哪儿、多宽、多高」，
  // 而栅格坏掉的样子一律不报错：招牌不显式跨满整行就缩进第一格去（`.app` 本体是 flex
  // 柱，换成 grid 之后那一行不会自己跨），三道 `minmax(0, …)` 少一道就在榜首出现十位数
  // 分数时把整页顶出屏幕。
  //
  // 最后一节是反面尺子：**999px 以下一个像素都不许跟着变**（玩家这一轮改的是电脑端），
  // 并且在量完之后往两处分数里塞一个十位数再量一遍——那条坑玩家 2026-09 实拍过。
  {
    name: '电脑端成绩页：三栏等宽等高，一屏全在',
    shard: 'd', secs: 15, port: 8877,
    run: ['scripts/check-records-desktop.mjs', SERVER],
  },

  // 小红书那一端的**样式降级层**：每一屏量两遍（浏览器自己认 clamp/aspect-ratio 的那
  // 一遍，和强制走降级路径的那一遍），逐个盒子比坐标和尺寸。
  //
  // ⚠️ 降级那一遍还会把 `aspect-ratio` / `inset` / `:has()` 从样式表里**真的剥掉**
  // （stripModernCss）：这台 Chromium 认得它们，不剥的话跑出来的是「降级层 ＋ 新内核」
  // ——源样式里那几条新写法正好把降级层漏掉的地方盖住，两遍量出来一模一样、门全绿，而
  // 真机上是坏的。两件真事就是这么躲过去的：倒数窗在 Chrome 61 上高度是 0（整个倒数那
  // 一端从来没出现过），以及「+N」原地压在分数上。
  //
  // 这一条慢（两个视口 × 十来屏 × 两遍，十分钟上下），所以它自己一片（方案 7-0：「check-oldcss
  // 单独一片」），也不进 check 那一条——那边的节奏不许被拖慢。它读的是 xhs/preview.html（不提交的构
  // 建产物），开头自己调 ensurePreview 重出一份，不用先跑 preview:xhs。
  {
    name: '小红书：样式降级层两遍对照',
    shard: 'oldcss', secs: 608, timeoutMin: 30,
    run: ['xhs/check-oldcss.mjs'],
  },

  // 小红书那一端的**老内核**（10-09 方案 7-0 收进来）：在新浏览器上把 Chrome 61 没有的那些接口
  // （Array.prototype.at / flat、String.prototype.replaceAll、ResizeObserver……）一个个删掉，再把
  // 五个玩法各打一局、走一遍不是棋盘的那几屏和每日挑战那一路。上一道量的是 CSS 被丢掉之后版面还
  // 在不在，这一道量的是 JS 一碰就抛错的那一类——小工具的最低内核是 Android 8.1 那一档的 WebView
  // 61，手边没有那样的真机，审核又要几天，这两道是唯一的老内核。和上一道一样自己重出预览页。
  {
    name: '小红书：老内核（缺接口）打一遍',
    shard: 'd', secs: 222,
    run: ['xhs/check-oldkernel.mjs'],
  },

  // 教学期间那盏呼吸灯（PR-13 / E23）。要开浏览器，因为这一道管的是假 DOM 量不到的
  // 两件事：类挂上之后那个元素**真的在动画**（要问 getComputedStyle，需要真 CSS），
  // 以及**绝不拦操作**——它真的拖一枚棋子，拖完看盘面变没变。
  //
  // 灯做成一层盖在棋盘上的蒙版也能「亮」，而那一层会把手指吃掉：教学期间棋子拖不动，
  // 一个错都不报。反证验过：给带子加上 pointer-events: auto + z-index，这一道当场红两条。
  //
  // ⚠️ 它**什么键都不预设**（除了语言）——预设 slides_tutorial_seen 会把被测的教学条
  // 整个关掉（CLAUDE.md 那五个坑的第四个）。
  //
  // 教学的呼吸灯（第 15 推）：亮的正好是「再走一步就能完成这一条」的那一步结算时会动到的
  // 全部棋子（2026-10-08 方案 3-E-2：格子 + 星星，同一步顺带凑出的别的组也亮）——门里自带
  // 一份独立的对照（从屏幕上读每一枚的位置、正反面、颜色，自己走一层），小球、方块各
  // 随机真滑二十几步，每一步结算完对一次；真的拖那一步，灯不拦手；手机端字号两倍、最
  // 多两行、换条时条子不变高、不压棋盘。六七分钟。
  {
    name: '教学的呼吸灯：亮对那一组，且不拦操作',
    shard: 'd', secs: 86, port: 8878,
    run: ['scripts/check-coach-aim.mjs', SERVER],
  },

  // 「有新版本，点一下刷新」那一行（第 13 推）。要开浏览器，因为被测的几件事只有真浏览
  // 器说得清。版本号那一问整条被 page.route 接走（第一问答一个 sha，往后答另一个），所以
  // 不用为这道门重出两次包。
  //
  // ④那一节是整道门最要紧的一节，比「它出来了」要紧：三档屏幕各量一遍「那一行整个在招牌
  // 那块玻璃里面」「**没有一张卡和它相交**」「按下去落在它自己身上」。浮在屏幕上的那一版
  // 就是在这儿倒的——主菜单那条鱼眼滚轴占满整屏，卡片从招牌和底排底下滑过去，所以这一屏
  // 上没有一块空地：那一版压着的正是炸弹那张卡和它的两枚 chip，而它自己收下点击。
  //
  // ⑤⑥ 两节是尺子：同一套动作，答案换成「版本号没变」「一直 404」「先问到后断网」，那一
  // 行一个字都不许冒——少了它们，①在「这一行永远都在」的实现下也会全绿。
  //
  // ③半那一节钉「只在主菜单上」：`.home-head-glass` 全站有七处（个人主页、战绩页、小屋那
  // 两屏……），选择器前面那个 `.home-page` 少了的话这一行会跟到每一页上去——最要命的是小屋
  // 那两屏，那上头按一下刷新，正赶上一局要开，他那一局就没了。
  //
  // 反证验过七处：对局中照说红 3 条、出厂就说红 4 条、换屏不重算红 4 条、读不到当成换版
  // 红 1 条、那一行挪回浮在屏幕上红 9 条、再给它加一句 position: fixed 红 2 条、撤掉选择器
  // 前面那个 .home-page 红 2 条。
  {
    name: '新版本提示：出得来，对局中不说',
    shard: 'b', secs: 31, port: 8976,
    run: ['scripts/check-new-version.mjs', SERVER],
  },

  // 四页改版（第 17 推）：战绩页、个人主页、帐号窗、邀请窗。4 个尺寸 × 4 种语言 × 浅色 / 深色
  // / 色盲，一圈四千六百来条：不溢出、不重叠、不被底栏盖住，等距 / 居中误差 ≤ 1px，对比度
  // （正文 4.5、大字和图标 3），免邮箱帐号的第一串默认遮住且没有《更换》，Esc 关窗，只放图标
  // 的键都有 aria-label，以及**这四页上真的生效的规则里一支写死的颜色都没有**（走
  // document.styleSheets 逐条过，不是 grep 源文件——一条规则属于哪一页只有浏览器说得清）。
  //
  // 反证验过二十种改坏法，各自红在该红的那一条上（写死一个颜色、徽章字改白、图标改灰褐、
  // 一颗药丸多垫 6px、十二格里一格变矮、法务键压上面板、徽章偏 5px、页边不对称、页底留白
  // 不够、色盲下累计分卡换色、法语标签不许折行、标题没了下划线、电脑端两栏不等宽、右栏没
  // 对齐左栏下沿、法务键没对上网格、第一串没遮、免邮箱帐号冒出《更换》、邀请窗不收 Esc、
  // 联络那颗没有 aria-label、战绩只画五行）。名单和红了几条记在《侵蚀阶梯决策.md》第 17 推。
  {
    name: '四页改版：战绩页、个人主页、帐号窗、邀请窗',
    shard: 'e', secs: 148, port: 8981,
    run: ['scripts/check-redesign-fit.mjs', SERVER],
  },

  // 管理员页《重建榜单》（第 14 推）：四个勾默认都不勾（「清空无限反转」从前默认勾着，
  // 每一次例行重建都顺手清一遍），勾了全清要先确认、点取消一个请求都不发，「清理旧名
  // 字」发 scrubNames 并把删了几条写到页上；「建立昵称索引」（第 16 推）发 nicknames 并
  // 只写那几个数、一个名字都不照抄。/api/scores 在浏览器里拦下来，不碰真的榜。
  {
    name: '管理员页《重建榜单》那四个勾',
    shard: 'b', secs: 4, port: 8983,
    run: ['scripts/check-mint-rebuild.mjs', SERVER],
  },

  // 个人主页头卡上的昵称（第 16 推）：昵称 + ✎、✎ 外面那一圈 8px 空地真的点不到任何一块、原地编辑（不长
  // 高、十二个字不顶出卡、右边那一截不被挤没）、Enter 存 / Esc 和 ✕ 不存、被占了说一句；小屋名字栏
  // 预填昵称、改了名先走改名接口。三种尺寸 × 四种语言，/api 在浏览器里拦下来。
  {
    name: '个人主页头卡上的昵称',
    shard: 'd', secs: 143, port: 8962,
    run: ['scripts/check-nickname-head.mjs', SERVER],
  },

  // 统一的《退出》（第 18 推）：计时、老虎机两页、无限反转、步步为营、炸弹挑选窗、多人小屋、成绩与排名
  // 八页，360×740 / 390×844 / 430×932 / 1512×982 四个尺寸——62px（成绩页那颗 2026-10-08 起是全站
  // token 的 73–99）、水平中线和底边各页一致（≤1px）、完整可见、不压内容、页底留够、按下去回对地方；
  // 手机战绩页一屏不滑、面板吃满剩下的高度、两块六格一行对一行；累计得分卡只剩那个数（3rem）、点开才
  // 有标题和同步提示，点开的那张底下没有《退出》。
  {
    name: '统一的《退出》和手机战绩页',
    shard: 'c', secs: 91, port: 8964,
    run: ['scripts/check-page-exit.mjs', SERVER],
  },

  // 成绩页两块面板一套行高、一套行距（2026-10-08 方案 3-C-2）：十二格一样高、就是 --rec-row-h；
  // 行高是原来 30px 的 1.3 倍（360×740 那一档放不下，退到 1.1 倍、一屏不滑）；每道缝 0–4px、两块一
  // 样；字和行首小图形跟着行高等比放大、在格子里竖着居中。手机三档 ＋ 电脑两档 × 简体、法文 × 没登录、
  // 有三局榜上三人。从前两块的缝各算各的（手机上摊到 29px），字号也各写各的。/api 在浏览器里拦下来。
  {
    name: '成绩页两块面板一套行高行距',
    shard: 'e', secs: 64, port: 8979,
    run: ['scripts/check-records-rows.mjs', SERVER],
  },

  // 成绩页上那张累计得分卡（2026-10-08 方案 3-C-3）：数字放大到 3rem（1.3 倍）而卡不长高；「重测长数
  // 字自动缩写阈值」——0 到 Number.MAX_SAFE_INTEGER 九个总分 × 320–1280 五个宽度 × 四种语言，每一串
  // 都一行、不出卡；手机上两块面板整体上移 12px。《退出》的尺寸和点开的大卡归 check-page-exit 量。
  {
    name: '成绩页上的累计得分卡',
    shard: 'e', secs: 94, port: 8978,
    run: ['scripts/check-total-card.mjs', SERVER],
  },

  // 4-3-2-1 那一页：今日挑战的和基础玩法的长得一样（2026-10-08 方案 3-F-1）。从前今日挑战借的是挑图
  // 形页的骨架，图小一圈、倒数窗高出 68px、《退出》是 62px 站在离底 116 的地方；现在套的是游戏外壳开
  // 局那一层。上半屏那一格、倒数窗、《退出》的位置大小逐项和基础玩法那一页比；今日那一局和输代号那一
  // 局两条路，手机两档、电脑一档。
  {
    name: '今日挑战倒数页和基础玩法的一样',
    shard: 'd', secs: 37, port: 8970,
    run: ['scripts/check-count-stage.mjs', SERVER],
  },

  // 倒数页那张图 ＝ 第二层上按下去的那一格（2026-10-08 方案 3-F-4：图标唯一映射 iconFor）。从前倒数页
  // 自己拼图：计时局摆一支绿脸的秒表、炸弹局摆灰底棋盘 ＋ 一颗炸弹徽记，和计时那一页、炸弹那一页按下去的
  // 那一格对不上。逐玩法从挑选层按下去（计时、无限反转、步步为营、炸弹六格、基础和布局从主菜单那张卡），
  // 量每一笔的形状和画出来的填色；老虎机那一局量的是「摆的是那台机器」。
  {
    name: '倒数页的图和第二层按下去的那一格是同一张',
    shard: 'b', secs: 111, port: 8968,
    run: ['scripts/check-mode-icons.mjs', SERVER],
  },

  // 整页滚动是原生的：电脑、手机都不接 Lenis 那层平滑滚动。10-08 方案 3-J 先摘掉触屏（「移动端触摸列表
  // 一律不做 Lenis 式平滑滚动」），10-09 补充方案第一部分第 10 条再把电脑滚轮那一层也整个拿掉（6-8：
  // 「Lenis、GSAP 都不进共享 src/」）。手机、电脑进个人主页，<html> 上都没有 lenis；源码和依赖里也没有。
  // 脚本名照旧叫 smooth-touch（清单按路径认门，换名等于撤一道加一道）。
  {
    name: '整页滚动是原生的（电脑手机都不接平滑滚动）',
    shard: 'a', secs: 8, port: 8967,
    run: ['scripts/check-smooth-touch.mjs', SERVER],
  },

  // 结算弹窗照玩家的两张设计图（2026-10-08 方案 3-I：「严格按玩家上传的设计图像素对齐」＋「横线下方……
  // overflow:hidden + touch-action:none，禁上下左右滑；内容压进固定高度，四语验收放得下」）。设计图上那一
  // 局（圆球 · 炸弹 · 430）填进真的结算弹窗，402×875 一倍像素截图，逐块扫墨的外框和图上的数比（±3px）；
  // 那张卡缩到图上的 279 宽逐块比；四种语言真打一局看结构；六种屏幕 × 四种语言装得下、键点得到；小屋
  // 那一份在的时候只有中间那一块放开滑。
  {
    name: '结算弹窗和设计图对得上、不滑',
    shard: 'e', secs: 157, port: 8966,
    run: ['scripts/check-end-design.mjs', SERVER],
  },

  // 全站标题不带横线、主菜单底排不带硬边（2026-10-08 方案 3-K：「所有 title 板块的横线移除……主菜单底部
  // 硬边框一并去掉……语义分隔需要留白就改 margin」）。七页共用的那块招牌（手机、横屏、电脑三种屏）、邀请窗
  // 的抬头、底排那块圆角板（三套主题）、几扇窗的标题都量；线占的那一截并进了外边距，所以也量排出来的距离
  // 还在——邀请窗那一条真撞过「并进去的外边距被更具体的 .modal h2 盖掉、整扇窗矮了 12px、什么都不报」。
  {
    name: '标题没有横线、底排没有硬边',
    shard: 'b', secs: 68, port: 8965,
    run: ['scripts/check-title-lines.mjs', SERVER],
  },

  // 主菜单上开窗、关窗，轴的中线不漂（2026-10-08 方案 3-D-3：「开关 5 次中线不漂」；3-C-6：从帐号窗
  // 底下那颗 ✅ 关也不许偏）。三条来路各量一遍：轴量完位置之后招牌又长高（副标题打字机打出第一个中
  // 文字、晚到的新版本提示）；窗开着时页面被推上去（手机键盘——无头浏览器没有键盘，先垫出键盘给的那
  // 段余地再推）；登录成功那一拍重画主菜单时把被推歪的滚动位置放回去。真注册一遍（免邮箱）。
  {
    name: '主菜单开窗关窗中线不漂',
    shard: 'c', secs: 46, port: 8977,
    run: ['scripts/check-axis-overlay.mjs', SERVER],
  },

  // 同一串种子码，每副棋盘发出同一副牌（第 19 推）：编号表二十行，每行造一串码、从《每日挑战》
  // 的输入框开两次比盘面（尺子：换一串码盘面必须不一样）；倒数那几秒页面上除了码和数字一个字
  // 都没有；存档里记着那串码；七色圆球那一天竖着拿手机先说「请横屏」。
  {
    name: '同一种子同一副牌',
    shard: 'seed-deal', secs: 705, timeoutMin: 30, port: 8973,
    run: ['scripts/check-seed-deal.mjs', SERVER],
  },

  // 主菜单那张《每日挑战》（第 19 推）：七天的底图颜色读自那七个图标文件、日期字的颜色、北京
  // 23:59:59→00:00:00 准确换日（图、数字、种子同时换；钟是 page.clock 拨的）、电脑宽屏一屏放
  // 得下、首玩期间也在。
  {
    name: '每日挑战那张卡与北京零点换日',
    shard: 'b', secs: 65, port: 8974,
    run: ['scripts/check-daily.mjs', SERVER],
  },

  // 分享卡上那一行「种子 XXXX-XXXX」（第 19 推）：在二维码说明底下、整个在明细上面（明细往下让
  // 一行、两行不叠）；每日挑战那一行更长（「· 每日 10/03」）；老档没有种子就不画。量的是导出
  // 那张 PNG 的像素。
  {
    name: '分享卡上的种子',
    shard: 'b', secs: 13, port: 8975,
    run: ['scripts/check-share-seed.mjs', SERVER],
  },

  // 屋主关掉网页走掉，坐在小屋页上的客人按《ok》（2026-10-08 方案 2-3）：打过局的拿到那张
  // 总战绩图（和屋主按《解散》、客人自己按《离开》同一样东西），一局都没打过的回主菜单，座位
  // 照样交回去。从前这一条按完就回主菜单，在这间屋子里打过的每一局一笔勾销。一台自己的服务
  // 器：开两间屋，兑 TESTMONTH、TESTYEAR 各一次。
  {
    name: '屋主走掉之后客人拿到的那张总战绩图',
    shard: 'd', secs: 57, port: 8984,
    run: ['scripts/check-host-gone-card.mjs', SERVER],
  },

  // localStorage 一碰就抛的环境（Chrome 关掉网站数据、一些 App 内置浏览器）里开站（2026-10-08
  // 方案 2-5）：主菜单出得来、开得了一局、个人主页打得开、一路没有没接住的错。从前 boot() 第一
  // 句 loadLang() 一抛就是一张白屏。前半节纯 node：watchRoom 的回调抛一次，轮询照样接着排。
  {
    name: 'localStorage 用不了也不白屏',
    shard: 'd', secs: 12, port: 8986,
    run: ['scripts/check-no-storage.mjs', SERVER],
  },

  // 六边圆球中心那颗空心球（2026-10-08 方案 2-4 B）：画在洞位上（截图量那一圈、圈里是空的）、
  // 和旁边的球一样大、不是棋子（不挂 .ball / data-r/c）、碰不着（按在它上面拖，什么都不动；
  // 尺子：按在旁边真球上同样一拖，那一行真的滑了，滑完洞还在原地）。
  {
    name: '六边圆球中心那颗空心球',
    shard: 'd', secs: 5, port: 8988,
    run: ['scripts/check-hex-hole.mjs', SERVER],
  },

  // 屋主等待页上那颗「不等了」（2026-10-08 方案 2-6）：客人的等待页上没有、屋主的有；按下去屋
  // 主和先交卷的人回到小屋页，挂机那一位手上那一局照旧开着（不拽人）；屋主照常开下一局。一台
  // 自己的服务器（兑一次 TESTMONTH）。
  // 10-09 补充方案 7-5 起：要按住才算（点一下不算）；被结束的人飘一句「屋主结束了这一局：您到刚
  // 才的 N 分已算进小屋总分」、不再报分；断着网被结束、回来时下一局已经开了的那一位也认得出来；
  // 两个人都看不到那句假话「离开太久了」。四个人、一个断网再连上，本地量 48 秒。
  {
    name: '屋主等待页上的「不等了」',
    shard: 'a', secs: 50, port: 8992,
    run: ['scripts/check-room-force-ui.mjs', SERVER],
  },

  // 屋主按了《解散小屋》、服务器那头没办成（2026-10-08 方案 2-7）：留在原页、屋子不忘，那一问
  // 原样再问一次、上面多一行「小屋还没解散」，客人那头小屋照旧开着；小屋页和主菜单横幅两个入口
  // 各拦一次 end。尺子：放行之后再按一次，真的散了。一台自己的服务器（兑一次 TESTMONTH）。
  {
    name: '解散没办成：不忘屋，再问一次',
    shard: 'a', secs: 17, port: 8994,
    run: ['scripts/check-disband-retry.mjs', SERVER],
  },

  // 榜没拉下来说「没拉下来」，不说「还没有人」（2026-10-08 方案 2-8）：记录页那块缩略图和点开
  // 之后那一整页，拉榜那一条断掉时各量一次；尺子：放行之后这台新服务器上确实没人，那时候说的
  // 才是「还没有人」。一台自己的服务器（兑一次 TESTMONTH）。
  {
    name: '榜没拉下来不说「还没有人」',
    shard: 'e', secs: 10, port: 8995,
    run: ['scripts/check-rank-network.mjs', SERVER],
  },

  // 小屋开局前那一问「会不会」答了「会」就记下来（2026-10-08 方案 2-10）：第一局客人没看过这
  // 一族的教学，服务器多留四秒、他被问；答「会」之后本机记下「看过了」，第二局同一族服务器不
  // 再多留、也不再问他。从前每一局都这样，全屋每局多等四秒。一台自己的服务器（兑一次 TESTMONTH）。
  {
    name: '小屋里答「会」就记下来',
    shard: 'c', secs: 27, port: 8996,
    run: ['scripts/check-room-knows.mjs', SERVER],
  },

  // 局中小屋过期了（10-09 补充方案 7-13 第 14 条）：一屋三人开局，让两台设备此后问小屋都答 404 noRoom
  // （库里那间屋没了的时候服务器答的就是这一句）。正打着的那个原地转成单人接着打；已经交了卷在等的那个，
  // 等待页撤掉、说一句、按《主页》回主页。对照：一阵普通的 502 照旧什么都不动。从前计分板对轮询失败一律
  // 不动，交了卷的人永远停在等待页上。一台自己的服务器（兑一次 TESTMONTH）。secs 是本地量的。
  {
    name: '局中小屋过期了要给一条回主页的路',
    shard: 'c', secs: 45, port: 8954,
    run: ['scripts/check-room-expired.mjs', SERVER],
  },

  // 每日挑战那一局没进今日榜，结算页上说一句明话（2026-10-08 方案 2-11）：三台设备各打一局，钟
  // 对的那台不说（尺子：服务器回 stored）；钟快三天、慢三天、对不上服务器的钟（HEAD 拦掉）的那
  // 两台，服务器回 rejected / late，结算页上都要说那一句。一台自己的服务器（兑三张码）。
  {
    name: '每日挑战没进今日榜要说一句',
    shard: 'e', secs: 36, port: 8997,
    run: ['scripts/check-daily-note.mjs', SERVER],
  },

  // 方块拖满一整圈不算一步（2026-10-08 方案 2-12）：在步步为营里量（左上那一格印的是余步）——一
  // 行、一列各拖满 6 格，余步一步不扣、那一行那一列原样；尺子：同样的手法拖一格，那一行真的变了。
  // 从前方块自己转，只拦了「没动」，拖满一圈照样记一步。一台自己的服务器（兑一次 TESTMONTH）。
  {
    name: '方块拖满一整圈不算一步',
    shard: 'c', secs: 13, port: 8998,
    run: ['scripts/check-square-fullturn.mjs', SERVER],
  },

  // 屋主替小屋挑玩法时那条横幅，两颗键手指按得着（2026-10-08）：真手机（isMobile + hasTouch）、真
  // 手指（触摸事件），静止时量一次、把轴推一把让卡片滑进横幅那一带再量一次，再真点「小屋里」「离开
  // 小屋」；390×844 和 360×640 两块屏。从前鱼眼轴整层压在横幅上面：看得见、按不着，推过轴之后按
  // 「离开小屋」反而点进了底下那张卡。一台自己的服务器（兑一次 TESTMONTH）。
  {
    name: '小屋挑玩法那条横幅手指按得着',
    shard: 'a', secs: 19, port: 8999,
    run: ['scripts/check-room-pick-tap.mjs', SERVER],
  },
];

/** 清单本身的毛病（check-ci-browser 调它）：片名不认识、端口撞了、脚本不在、地址给了却没服务器…… */
export function problems() {
  const out = [];
  const names = new Set();
  const ports = new Map();
  for (const g of GATES) {
    if (!g.name) out.push('有一道门没有名字');
    if (names.has(g.name)) out.push(`门名重了：${g.name}`);
    names.add(g.name);
    if (!SHARDS.includes(g.shard)) out.push(`${g.name}：片名「${g.shard}」不在 SHARDS 里`);
    if (!Number.isFinite(g.secs)) out.push(`${g.name}：没有 secs（分片要按它摊）`);
    if (!existsSync(join(ROOT, g.run[0]))) out.push(`${g.name}：脚本 ${g.run[0]} 不在`);
    if (g.port) {
      if (ports.has(g.port)) out.push(`端口 ${g.port} 撞了：${ports.get(g.port)} / ${g.name}`);
      ports.set(g.port, g.name);
      if (!g.run.includes(SERVER)) out.push(`${g.name}：起了服务器却没把地址交给门`);
    } else if (g.run.includes(SERVER) || g.env) {
      out.push(`${g.name}：要服务器的地址（或服务器的环境变量），却没有 port`);
    }
  }
  for (const s of SHARDS) if (!GATES.some((g) => g.shard === s)) out.push(`片「${s}」一道门都没有`);
  return out;
}

const GH = process.env.GITHUB_ACTIONS === 'true';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minutes = (s) => `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`;

/** 正在跑的那台服务器——这一片被取消（job 超时、手点取消）时顺手关掉它。 */
let live = null;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (live && live.exitCode === null) live.kill('SIGKILL');
    process.exit(130);
  });
}

async function waitUp(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return false;
}

function stop(child) {
  return new Promise((done) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return done();
    const hard = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => {
      clearTimeout(hard);
      done();
    });
    child.kill('SIGTERM');
  });
}

function runGate(args, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(t);
      done({ code, signal, timedOut });
    });
  });
}

async function one(g) {
  for (const p of g.pre || []) {
    const r = spawnSync(p[0], p.slice(1), { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) return `${p.slice(0, 2).join(' ')} 退出 ${r.status}`;
  }
  const url = g.port ? `http://localhost:${g.port}/` : null;
  if (url) {
    live = spawn(process.execPath, ['scripts/dev-server.mjs', String(g.port), 'dist'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: { ...process.env, ...(g.env || {}) },
    });
    if (!(await waitUp(url))) return `服务器 ${g.port} 三十秒内没起来`;
  }
  const limit = g.timeoutMin || 20;
  const r = await runGate(g.run.map((a) => (a === SERVER ? url : a)), limit * 60_000);
  if (r.timedOut) return `超过 ${limit} 分钟，掐掉了`;
  if (r.code !== 0) return `退出 ${r.code ?? r.signal}`;
  return '';
}

function list() {
  for (const s of SHARDS) {
    const gs = GATES.filter((g) => g.shard === s);
    const total = gs.reduce((n, g) => n + g.secs, 0);
    console.log(`${s.padEnd(10)} ${String(gs.length).padStart(2)} 道  约 ${minutes(total)}`);
  }
  const bad = problems();
  if (bad.length) console.log(`\n清单有毛病：\n  ${bad.join('\n  ')}`);
}

async function main(argv) {
  if (argv[0] === '--list') {
    list();
    return 0;
  }
  const which = argv[0];
  if (which !== 'all' && !SHARDS.includes(which)) {
    console.error(`用法：node scripts/ci-browser.mjs <${SHARDS.join(' | ')} | all> [关键字]   或   --list`);
    return 2;
  }
  const bad = problems();
  if (bad.length) {
    console.error(`清单有毛病，先修：\n  ${bad.join('\n  ')}`);
    return 2;
  }
  const kw = argv[1];
  const todo = GATES.filter((g) => (which === 'all' || g.shard === which) && (!kw || g.name.includes(kw) || g.run[0].includes(kw)));
  if (todo.length === 0) {
    console.error(`「${which}${kw ? ' / ' + kw : ''}」一道门都没挑到`);
    return 2;
  }
  if (todo.some((g) => g.port) && !existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('dist/ 里没有 index.html——先 npm run build（门读的是 dist）');
    return 2;
  }
  const results = [];
  for (const g of todo) {
    const t0 = Date.now();
    console.log(GH ? `::group::${g.name}` : `\n==== ${g.name}  [${g.run[0]}]`);
    const why = await one(g);
    await stop(live);
    live = null;
    const secs = (Date.now() - t0) / 1000;
    if (GH) console.log('::endgroup::');
    if (why && GH) console.log(`::error title=browser · ${g.name}::${g.run[0]}：${why}`);
    results.push({ g, why, secs });
  }
  console.log(`\n==== ${which}${kw ? ' / ' + kw : ''}`);
  for (const { g, why, secs } of results) {
    console.log(`${why ? 'FAIL' : 'PASS'}  ${secs.toFixed(1).padStart(6)}s  ${g.name}  [${g.run[0]}]${why ? '  ' + why : ''}`);
  }
  const red = results.filter((r) => r.why).length;
  const total = results.reduce((n, r) => n + r.secs, 0);
  console.log(`\n${results.length - red} 过 · ${red} 红 · ${minutes(total)}`);
  return red ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
