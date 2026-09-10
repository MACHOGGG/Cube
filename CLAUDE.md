# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚠️ 先读这一条：推送 = 上线

`claude/fangtang-game-web-app-xbecza` **就是 Vercel 的生产分支**。推上去几十秒后
play-slides.com 就变了，没有预发环境，没有中间确认。所以：

- 推之前把相关的门跑完（见下面《检查门》）。
- `vercel.json` 是**按 schema 校验**的：多一个它不认识的顶层字段（比如想写个
  `"//comment"` 当注释）会让**整份配置作废**，部署直接失败，报
  "Configuration error: couldn't load a valid project configuration"。JSON 里
  不要写注释。
- 构建脚本用到的东西必须是 `package.json` 里**声明过**的依赖。搭 vite 的便车
  （靠 npm 把传递依赖平铺到 node_modules 顶层）在本地能跑，在 Vercel 上按
  lockfile 装的时候会掉。

## 这是什么

「Slides」（方糖）——一个滑动拼色块的解谜游戏。一份 `src/` 出三个端：

| 端 | 入口 | 说明 |
| --- | --- | --- |
| 网页 / iOS | `index.html` + `src/` | play-slides.com，Capacitor 打包成 iOS app |
| 小红书小工具 | `xhs/` | 复用 `src/`，但**必须跑在 Chrome 61 上**，有一整套降级层 |
| 微信小游戏 | `wxgame/` | 独立骨架，只做方块和小球，暂停中 |

## 命令

```bash
npm run dev          # vite 开发服务器（不带 api/）
npm run build        # tsc -b && vite build && 生成五张法务静态页
npm run typecheck    # 只验类型

# 网页端要跑 api/ 的时候（多人小屋、兑换码、登录都要）
node scripts/dev-server.mjs 8815 dist    # 内置 api/ + 内存版 store
node scripts/check-<名字>.mjs http://localhost:8815/

# 小红书端
npm run build:xhs
npm run check:xhs:all   # 五个门串起来跑，约 10–15 分钟
```

`scripts/dev-server.mjs` 自己设 `ALLOW_MEMORY_STORE=1`，所以小屋和兑换码活在
这个进程的内存里，进程一关就没了。它还种四张测试兑换码：`TESTMONTH` /
`TESTYEAR` / `TESTHALF` / `TESTLIFE`。

## 检查门（`scripts/check-*.mjs`）

没有 npm test，也没有测试框架。**51 个门就是这个项目的测试**，每个门盯着一件
具体的、真出过的事故。写完改动挑相关的跑，别全跑（全跑要一小时以上）。

三类，跑法不同：

```bash
# ① 独立跑，什么都不用起
node scripts/check-scoring.mjs /tmp/scoring.mjs     # 先 esbuild 打包被测模块，见 ci.yml
node scripts/check-css-fallbacks.mjs                # 注意：它收目录，不收 URL

# ② 直接跑 api/ 那几个模块，不用起服务器（脚本自己设 ALLOW_MEMORY_STORE）
node scripts/check-entitlement.mjs

# ③ 要 dev-server（多数还要 Chromium）
node scripts/dev-server.mjs 8816 dist &
node scripts/check-multiplayer.mjs http://localhost:8816/
```

CI（`.github/workflows/ci.yml`）只收第 ①② 类里跑得快的那几个——要开浏览器的、
要等真实超时的都留在本地手跑，文件头上写明了为什么。

**跑门时的三个坑**（都真的坑过人）：

- **兑换码在一个 dev-server 进程里只能用一次。** 两个都要兑码的门跑在同一台
  服务器上，第二个会莫名其妙红。**一个门一台新服务器。**
- **`check-room-total` 故意 sleep 95 秒**（`ABSENT_MS` 是 90 秒，等不满进不了
  被测的那条路）。它不是卡住了。
- **绝对不要用 `pkill -f`** 去关 dev-server——它会连 Bash 工具自己的 shell 一起
  杀掉（exit 144）。用 python 起进程再 `terminate()`，或者换个端口。

Playwright 的浏览器在 `/opt/pw-browsers/chromium`（`executablePath` 要写这个），
不要跑 `playwright install`。

## 架构：需要读好几个文件才看得出来的那些

### 八副棋盘，一个循环

`src/shapes/` 下八个模块（`square` `squareDiamond` `circle` `circleHex`
`circleSeven` `triangle` `triangleBig` `triangleAdvanced`）各自导出一个
`create<X>Game()` 工厂，全部实现 `src/shapes/types.ts` 里同一份 `ShapeGameOpts`
契约。**`src/engine/gameController.ts` 是唯一那个游戏循环**，八副棋盘共用它。

所以「加一个玩法」多半**不是写新游戏**，而是给 `ShapeGameOpts` 传个选项：
`timeLimitSec`（计时）、`bomb`（炸弹）、`targets`（老虎机换得分图案）、
`flip`（无限反转）、`practice`（小屋等待页的练习盘）、`coach`（头一局的教学条）。

### 家族按 id 前缀认，但有一个陷阱

好几处（`src/ui/gameShell.ts` 的 `familyOf`、暂停里的《怎么玩》、老虎机挑图案）
靠 **id 前缀**分三家：`square*` / `circle*` / `triangle*`。

**陷阱**：`main.ts:94` 是 `const triangleGame = createTriangleBigGame()`
——两个三角文件在 2026-09 对调过内容，**文件名和主菜单上的位置对不上**。按前缀
认不受影响，按文件名推断会错。

**另一个陷阱**：家族 ≠ 规则。`squareDiamond` 长得是方块，消行行为却像小球/三角
（最少 3 个、原地留空位）。所以 `gameShell.ts` 里分了 `familyOf()`（认棋子长相，
老虎机用）和 `rulesShapeOf()`（认消行行为，《怎么玩》用）两个函数。

### 权益：三种身份，一处判定

「这个人是不是 Slides 天才」有三条来路，判定只写一遍：

- **`api/_entitlement.js`** —— `resolveEntitlement()`（登录/解锁都走它）和
  `isGenius()`（开小屋、看排行榜都问它）。
  - 内部码：权益记在我们自己的库里（`account.until`）。
  - 刷卡订阅：**本地不存到期日**，每次去问 Creem。
  - 商店收据：**目前一律不信**（还没接苹果/谷歌的收据校验，商店版也没上线）。
- **铁律：邮箱地址本身不是证据。** 它印在收据上，谁都知道得到。每条会放行的路
  都要先拿令牌证明「这个邮箱是打请求这个人的」。
- 客户端那份缓存在 `src/engine/subscription.ts`，`isGenius()` 是同步的、可以在
  渲染里调。

### 卖价：先问在哪个柜台

`src/engine/channel.ts` 的 `salesChannel()` 读 `window.Capacitor` 判断
web / ios / android。`src/engine/pricing.ts` 的 `plans()` **只返回一份价目表，
从不返回两份**——网页端看不到人民币价，App 端看不到美元价。任何要印价格的地方
都从这儿走。

**当前只有网页端的两个美元价是实施了的**（US$1.99/月、US$4.99/年，Creem 收
款）。商店渠道还没上线，法务文本里**不要写任何未实施的定价**。

### 共享状态：只有真的必须共享的才存

`api/_store.js` —— Redis over REST（Upstash 或 Vercel KV，同一套协议）。

- 存的只有两样：**小屋**和**内部码开出来的账号**。订阅没有数据库，每次去问
  Creem，所以不存在第二份会走样的副本。
- **小屋存成 Redis hash，一个玩家一个 field**，绝不是一个 JSON blob——八个人
  同时报分，读-改-写整份文档会丢掉大部分。
- 没有真 Redis 也没有 `ALLOW_MEMORY_STORE=1` 时，接口回「这个功能还没开」，
  而不是半работ着。

### 文案：四种语言，两处底稿

- **`src/i18n.ts`** —— 界面上所有的字，四种语言（`en` `fr` `zhHans` `zhHant`）。
  新增一句就要四种都写。
- **`src/legal.ts`** —— 五份法务文档（定价/条款/退款/隐私/联系）的**唯一底稿**。
  `scripts/build-legal.mjs`（跟在 `npm run build` 后面自动跑）从它生成
  `dist/{pricing,terms,refund,privacy,contact}.html` 五张静态页；应用里那个弹窗
  读的也是它。**改条款只改 legal.ts**，别去改生成出来的 html。
  - `only: 'web' | 'store'` 把只对某一个柜台成立的条款挡在另一个柜台外面。
  - 联系邮箱是 `CONTACT_EMAIL` 一个常量，全站引它。

法务文本里的每一句都是**对代码实际行为的陈述**（存了哪些字段、哪些布局免费）。
支付审核把「网站陈述与实际不符」直接归为 false information，比缺一份文档严重。
改代码改到这些行为时，**回来同步这五份文档**。

## 服务端 `api/`

Vercel serverless functions，纯 `.js`（不过 tsc）。`_` 开头的是共用模块：

| 文件 | 管什么 |
| --- | --- |
| `_creem.js` | Creem REST 调用、`send()` / `readBody()` |
| `_store.js` | Redis over REST + 内存兜底 |
| `_accounts.js` | 账号结构、scrypt 密码、多设备令牌、锁定计数 |
| `_entitlement.js` | 谁是天才（见上） |
| `_ratelimit.js` | `tooMany(bucket, id, limit, windowS)` + `callerId(req)` |
| `_mail.js` | 唯一一种邮件：解锁验证码，走 Resend |

面向外的：`subscription`（登录/查权益）、`passcode`（设/改密码）、`unlock`
（忘密码的解锁码）、`redeem`（兑内部码）、`checkout` / `portal`（Creem）、
`room`（小屋）、`scores`（战绩与排行榜）、`mint`（批量发码，`ADMIN_TOKEN` 保护）。

## 约定

- **注释解释「为什么」，而且经常点名那次事故。** 这个仓库的注释密度和风格是刻意
  的——很多注释写着「原先这儿是 X，于是玩家会遇到 Y」。新写的代码照这个来。
- **提交信息用中文，写正文。** 用 `git commit -F <文件>`，别用 `-m`。正文说清
  「改了什么」和「原先为什么是错的」。
- **不要做没被要求的改动。** 觉得顺手改了更好，先问。
- **有一处卡住，先做后面无关的**，别停下来等。
- **回复用中文。**

### 站点原则（产品侧，玩家定的）

- 少文字——必须有字的地方除外。
- 不要出现意料之外的界面。
- 不要让玩家出现意料之外的疏漏操作。

## 环境变量

见 `.env.example`。`.env` 是 gitignore 的，生产值填在 Vercel 后台。

- `CREEM_API_KEY` / `CREEM_PRODUCT_MONTHLY` / `CREEM_PRODUCT_YEARLY` ——
  **现在用的是测试密钥**（`creem_test_` 开头）。上线前必须换成正式密钥并作废
  旧的。
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` —— 没有它，小屋和兑换码报「还没开」。
- `RESEND_API_KEY` / `MAIL_FROM` —— **还没配**。没配时忘记密码那一屏告诉玩家
  写信到支持邮箱，而不是假装发出去了。
- `ADMIN_TOKEN` —— 至少 32 个随机字符。它背后是「无限发码」和「导出全部玩家
  邮箱」。

**密钥不要外发、不要提交、不要写进对话。** 需要用户去后台填的，告诉他填在哪里
就行，不要让他把值贴回来。

## 其他

- `scripts/` 里除了门，还有 `build-legal` `build-wxgame` `build-artifact`
  `gen-app-icons` 等生成脚本，和 `ui-snapshot` / `ui-screens` 两个截图工具。
- `slides-simulator.html` / `slides-interface.html` 是给玩家自己调排版的可视化
  台子。
- 四份上手指南在仓库根：`iOS上手指南.md`、`后台数据指南.md`、
  `微信小游戏上手指南.md`、`抖音小游戏上手指南.md`。
- 微信小游戏 AppID `wx9cab5874e6df2aee` 可以出现在代码里；AppSecret 和云开发
  密钥不可以。
