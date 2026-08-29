# 在 Mac 上用 Xcode 跑 Slides

这份文档只讲一件事：怎么把这个网页游戏，变成在你 Mac 的 iPhone 模拟器里
跑起来的 App。

用的是 **Capacitor**——它不改动游戏本身，只是造了一个原生外壳，把
`npm run build` 产出的那份网页装进去。网页版和 App 版永远是同一份代码。

---

## 〇、先准备（只做一次）

| 需要 | 说明 |
| --- | --- |
| macOS | Xcode 只能装在 Mac 上 |
| **Xcode 15 或更新** | Mac App Store 搜 Xcode，免费，约 10GB，下载很慢，建议睡前挂着 |
| Node.js 18+ | 终端里 `node -v` 能出版本号就行 |

装完 Xcode 后**先打开它一次**，同意许可协议、让它装完附加组件，否则
后面的命令会报错。

---

## 一、第一次跑（约 5 分钟）

打开「终端」（Terminal），进入项目文件夹，依次执行：

```bash
git pull                 # 拉最新代码
npm install              # 装依赖（第一次会慢一点）
npm run ios:sync         # 构建网页 + 塞进 iOS 工程
```

`npm run ios:sync` 是关键的一步，它做两件事：

1. 跑 `npm run build`，生成 `dist/`（和线上网站一模一样的那份）
2. 把 `dist/` 复制进 `ios/App/App/public/`

> **为什么必须跑这一步？**
> `ios/App/App/public/` 里放的是构建产物，不在 git 里（否则每次改代码都
> 要提交一堆重复文件）。所以刚 `git pull` 下来时它是**空的**，直接开
> Xcode 会看到白屏。

然后打开工程：

```bash
npm run ios              # 会自动构建并唤起 Xcode
```

或者手动：在访达里双击 `ios/App/App.xcodeproj`。

---

## 二、在 Xcode 里按播放键

1. Xcode 打开后，**等左下角的进度条跑完**（它在下载 Swift 依赖，第一次
   要一两分钟）
2. 顶部中间有个设备选择框，写着 `App > 某某设备`，点它
3. 选一个模拟器，比如 **iPhone 16 Pro**
4. 按左上角的 **▶️**（或键盘 `⌘R`）

模拟器窗口会弹出来，Slides 就在里面跑了。用鼠标拖动就相当于手指滑动。

**第一次编译要 1-3 分钟**，之后就快了。

---

## 三、以后每次改了代码

我在这边推送新版本后，你只需要：

```bash
git pull
npm run ios:sync
```

然后回到 Xcode 按 ▶️。**不用重新配置任何东西。**

---

## 四、装到自己的 iPhone 上（可选）

模拟器不用花钱，装到真机需要签名：

1. 用数据线把 iPhone 连上 Mac，手机上点「信任此电脑」
2. Xcode 里点左侧的 `App` 项目 → 中间选 `App` target → `Signing &
   Capabilities`
3. 勾上 **Automatically manage signing**
4. `Team` 下拉框选 `Add an Account...`，用你自己的 Apple ID 登录（**免费**）
5. `Bundle Identifier` 改成一个别人没用过的，比如 `com.你的名字.slides`
6. 顶部设备选择框改成你的 iPhone，按 ▶️
7. 手机上第一次会提示「不受信任的开发者」→ 去 **设置 → 通用 →
   VPN与设备管理**，点你的 Apple ID，选「信任」

⚠️ 免费账号签的 App **7 天后会失效**，重新按一次 ▶️ 即可。想永久有效或
上架 App Store，需要 Apple Developer Program（**99 美元/年**）。

---

## 五、出问题时

| 现象 | 原因 / 解决 |
| --- | --- |
| 模拟器里是**白屏** | 忘了跑 `npm run ios:sync`，或者跑之后没重新按 ▶️ |
| `command not found: cap` | 没跑 `npm install` |
| Xcode 报 `Signing for "App" requires a development team` | 只在装真机时需要处理，跑模拟器的话把设备切回模拟器即可 |
| Swift 依赖一直转圈 | 网络问题，Xcode 菜单 `File → Packages → Reset Package Caches` |
| 改了代码但 App 里没变化 | 一定要先 `npm run ios:sync`，Xcode 不会自动重新构建网页部分 |

---

## 六、几个你可能会问的

**这个 App 需要联网吗？**
不需要。网页文件全部打包在 App 里，离线也能玩。

**改了游戏内容，网站会受影响吗？**
不会，反过来也一样——两边读的是同一份 `src/`，构建出同一份 `dist/`。
网站由 Vercel 从 GitHub 自动部署，App 由你在 Xcode 里手动构建。

**能上 App Store 吗？**
技术上可以，工程已经是完整的。流程上需要：99 美元/年的开发者账号、
应用截图、隐私政策、App Review 审核（通常几天）。

**安卓呢？**
同一套 Capacitor 加一行 `npx cap add android` 就能生成 Android 工程，
不需要 Mac。需要的话跟我说。

---

## 附：这次改动碰了什么

| 文件 | 说明 |
| --- | --- |
| `capacitor.config.ts` | 新增。告诉 Capacitor 网页在 `dist/` |
| `ios/` | 新增。完整的 Xcode 工程 |
| `package.json` | 加了 3 个 devDependency 和 2 个脚本 |

**没有碰** `src/`、`index.html`、`vite.config.ts`、`vercel.json`——
网页构建产物与改动前逐字节一致，线上网站和 Artifact 测试链接都不受影响。
