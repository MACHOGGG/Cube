# Slides · 小红书小工具版

这一版**自成一个目录**，和另外两版完全分开保存：

| 版本 | 源码 | 产物 | 谁在跑 |
| --- | --- | --- | --- |
| 网页版 | `src/` + `index.html` + `vite.config.ts` | Vercel | play-slides.com |
| 微信小游戏 | `wxgame/` | `wxgame/game.js` | 微信（暂停中） |
| **小红书小工具** | **`xhs/`（本目录）** | **`xhs/dist/` + zip** | 小红书笔记里的小工具 |

改这一版**不会动到**网页版的 `src/style.css`、`index.html`、`vite.config.ts`，
也不会动 `wxgame/`。反过来也一样。

## 但玩法规则是共用的，不是抄的

`xhs/src/` 里只有这一版**自己**的东西：入口、主菜单、本机记录、介绍页、
Chrome 61 基线样式、打包配置。**棋盘、规则、手感、动画、结算、战绩图全部
从 `src/` 引用**（`createSquareGame` / `createCircleGame` / `engine/*`），
一行都不复制。

理由是玩家定的那一条：选出来的玩法要「完全复刻一样」。抄一份的话，网页版
以后改一次规则，这边就落后一次——微信那版是抄的，已经开始对不齐了。引用是
只读的：小红书这一版从不修改 `src/` 里的任何文件。

五个玩法就是网页版同一个入口的五组开关（`ShapeGameOpts`）：

| 玩法 | 怎么开 |
| --- | --- |
| 基础方块 | `createSquareGame().mount(el, back, {})` |
| 基础小球 | `createCircleGame().mount(el, back, {})` |
| 炸弹 | `{ bomb: true }` |
| 老虎机 | `{ targets: [老虎机转出来的两个图案] }` |
| 无限反转 | `{ flip: true }` |

## 和网页版不一样的三处（玩家点头的）

1. **没有排行榜**——小工具不联网。改成**本机游玩历史**（localStorage）。
2. **没有登录 / 订阅 / 天才**——五个玩法全部免费打开。
3. **分享战绩图**改走小红书的 JSBridge：存相册、发笔记。网页版那条「长按
   保存」在这儿行不通（长按菜单被容器禁掉了）。

多人小屋整块不做。

## 怎么打包

```
npm run build:xhs
```

出来的是 `xhs/dist/`（`index.html` 在根）和一个可以直接传进 Builder Hub 的
`xhs/slides-minitool.zip`。

`dist/` 不进仓库（根 `.gitignore` 里 `dist` 那条），**但 zip 进**——这是故意
的：玩家那台电脑上没有 Node，跑不了 `npm run build:xhs`，只能从 GitHub 网页
上把 zip 下下来传进 Builder Hub。直链：

<https://github.com/MACHOGGG/Cube/raw/refs/heads/claude/fangtang-game-web-app-xbecza/xhs/slides-minitool.zip>

所以每次改完这一版，**都要重新 `npm run build:xhs` 再提交那个 zip**，否则玩
家下到的还是上一版。

规范和限制见 `.claude/skills/minitool-zip-builder/`（小红书官方那份技能包）。
