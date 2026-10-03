# Slides 微信小游戏

> **⚠️ 这一端停在旧规则（2026-10-03，定稿方案第 20 推）。** `npm run build:wxgame` 编译不过是已知
> 情况：`src/` 早已换成侵蚀阶梯那一套规则，这一端还在 import 已经删掉的东西（`growParallelogram`、
> `createStreakTracker`，外加两处参数个数对不上，一共四个类型错误）。恢复时按**完整移植**做一个
> PR，不要一处一处地补到能编译——补出来的是一副规则和网页端对不上的棋盘。
> `cloud/` 里的换码草案（`cloud/redeem`）作废。

主菜单 + 方块 / 小球两副棋盘（三角不做进小游戏）。怎么打开、怎么把新改动拿进开发者工具、
后面怎么做，见仓库根目录的《微信小游戏上手指南.md》。

- `game.js` 是打包产物，不要手改；改 `src/` 之后跑 `npm run build:wxgame`。
- `node scripts/check-wxgame.mjs` 跑规则回归，并在浏览器里真拖一下、截一张图。
- `cloud/` 是云函数草案（记一局累计得分、换天才码），开通云开发之后才能部署，见 `cloud/README.md`。
  **换码那一份（`redeem`）作废**，见上。
