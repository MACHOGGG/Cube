# 云函数草案（累计得分 + 换天才码）

这两个云函数是《微信小游戏上手指南.md》第四节那套「全部免费、累计得分换正规版天才
码」的服务器一侧。**它们还没有部署、也没法在仓库里跑**（要微信云开发的环境），接口和
数据结构先写好，开通云开发之后照下面部署。

## 部署

1. 后台开通云开发，拿到环境 ID；开发者工具里「后端服务」改成「微信云开发」。
2. `project.config.json` 里加一行 `"cloudfunctionRoot": "cloud/"`。
3. 工具左侧文件树里右键 `cloud/bankRun` →「上传并部署：云端安装依赖」；`redeem` 同样。
4. 云开发控制台 → 数据库 → 新建三个集合：`players`、`runs`、`redemptions`，权限都选
   「仅创建者可读写」或「所有用户不可读写」（客户端不直接碰它们，只走云函数）。
5. 云开发控制台 → 云函数 → `redeem` → 配置 → 环境变量：加 `ADMIN_TOKEN`（Vercel 上
   同名那个值）和 `MINT_URL`（`https://play-slides.com/api/mint`）。**只在这里填，不进
   代码，不进聊天。**

## 数据

- `players`：`{ _id: openid, total, spent, runs, lifeRedeemed, updatedAt }`
- `runs`：`{ openid, mode, seed, score, moves, seconds, at }`（每局一条，查账用）
- `redemptions`：`{ openid, tier, points, plan, code, at }`（换出去的码，「我的兑换」读它）

## 客户端怎么调

```js
// 一局打完
wx.cloud.callFunction({ name: 'bankRun', data: { mode: 'square', seed, score, moves, seconds } });
// 兑换页
wx.cloud.callFunction({ name: 'redeem', data: { tier: 'month' } })
  .then((r) => r.result); // { ok: true, code, balance } 或 { ok: false, reason }
```
