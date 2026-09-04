# Slides 微信小游戏

主菜单 + 方块 / 小球 / 三角三副棋盘。怎么打开、怎么把新改动拿进开发者工具、
后面怎么做，见仓库根目录的《微信小游戏上手指南.md》。

- `game.js` 是打包产物，不要手改；改 `src/` 之后跑 `npm run build:wxgame`。
- `node scripts/check-wxgame.mjs` 跑规则回归，并在浏览器里真拖一下、截一张图。
- `cloud/` 是云函数草案（记一局累计得分、换天才码），开通云开发之后才能部署，见 `cloud/README.md`。
