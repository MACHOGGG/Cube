# 换图标：把 SVG 放这里

一个图标一个文件。**放进来就生效，删掉就变回原来那版**，不用改任何代码。

文件名必须和下面清单里的完全一致（全小写，`.svg` 结尾）。名字写错不会报错，
只会没反应——所以拿不准就去 `design/icons/` 里找同名的那个文件对一下。

## 从哪里拿现成的

跑一次 `node scripts/icon-sheet.mjs`，`design/icons/` 里会出现现在网页上用着
的全部 43 个图标，文件名已经是对的。**用设计软件打开那个文件改，改完存到这个
文件夹**，画布尺寸和图形占多大一块就都是对的。同一个文件夹里还有一张
`sheet.png`，是全部图标的对照表。

## 导出时的三条

1. **不要包含画板背景**（Sketch 的 "Include artboard background"、Figma 的
   "Include bounding box"）。带上会让图标四周多一圈空白，放上去显小。
2. **颜色用普通 HEX**，例如 `#E9A53C`。不要 `color(display-p3 ...)`——浏览器
   认，但很多工具链不认，之前吃过一次亏。Figma 里把 color profile 选 sRGB。
3. **图形要撑满画布**。现在这批图标是顶着画布边缘画的，你如果四周留了白边，
   放上去会比旁边的小一圈。

第 2 条有个例外要说清楚：**Sketch 导出的 `color(display-p3 …)` 不必手工改回
HEX**，`ui/customIcons.ts` 的 `sRGBOnly()` 在打包时替你换掉了（走 P3→XYZ→sRGB
两段矩阵，不是把三个数字直接当 sRGB 用）。那一条留着是因为**别的工具链**——
`scripts/` 里几支出图的脚本、小红书那一版的降级层——不认这个写法。自己改和让
它替你改，出来的十六进制是同一个。

## 固用色（玩家 2026-09-27 给的色卡）

整站设计参照这八个颜色，新画的图标、新加的界面都从这里取，不要再调一个相近的
出来。左边是设计文件里那个 P3 值，右边是它在网页上真正画出来的那个 sRGB——两
列是同一个颜色的两种写法，不是两个颜色。

| 用在哪 | P3（设计文件里） | sRGB（网页上） |
|---|---|---|
| 砖红 | `0.702 0.380 0.373` | `#c05b5c` |
| 绿 | `0.082 0.522 0.141` | `#008703` |
| 蓝 | `0.290 0.376 0.698` | `#4461b8` |
| 橙 | `0.910 0.533 0.227` | `#f7821b` |
| 紫 | `0.430 0.356 0.665` | `#715aaf` |
| 深灰 | `0.298 0.298 0.298` | `#4c4c4c` |
| 橙红 | `0.690 0.290 0.161` | `#be411a` |
| 纸色 | `0.953 0.890 0.769` | `#f6e2c0` |

## 清单

| 文件名 | 是哪个 |
|---|---|
| `base-square.svg` `base-circle.svg` `base-triangle.svg` | 主菜单最上面三个基础玩法 |
| `timed-combined.svg` | 手机主菜单上那支计时图标（现在是沙漏，从前画的是合体秒表） |
| `bomb-90s.svg` | 时长徽记星爆（内置那张上面的秒数从 engine/modeClock.ts 来）。**画布是 260×100，不是正方形** |
| `bomb-basic-*.svg` `bomb-timed-*.svg` `bomb-advanced-*.svg` | 炸弹卡片里的九个小图标（`*` 是 square/circle/triangle） |
| `bomb-square.svg` 等三个 | 偷懒写法：三档共用同一套形状 |
| `more-square.svg` `more-circle.svg` `more-triangle.svg` | 「更多布局」的三张「+」卡 |
| `more.svg` | 偷懒写法：三张一起换 |
| `layout-squareDiamond.svg` `layout-circleHex.svg` `layout-circleSeven.svg` `layout-triangleBig.svg` `layout-triangleAdvanced.svg` | 五个具体布局。**triangleAdvanced 是 2:1 的宽画布** |
| `nav-profile.svg` `nav-records.svg` | 底部导航两颗 |
| `sound-on.svg` `sound-off.svg` | 个人主页的声音开关 |
| `lock.svg` | 未解锁内容旁边的小锁 |
| `slot-machine-menu.svg` | 主菜单上《随机得分目标》那张老虎机（窗口里画着得分目标） |
| `slot-machine.svg` | 开局时真的转起来的那台（两个窗口）。**画布 897×521**，滚筒窗口的位置在 `slotReels.ts` 里按它量 |
| `ctl-pause.svg` `ctl-finish.svg` | 游戏进行中的暂停 / 完成 |
| `ctl-tier-basic.svg` `ctl-tier-timed.svg` `ctl-tier-advanced.svg` | 炸弹那一页左边那一列：基础 / 计时 / 进阶三档各一枚小图标（10-08 方案 3-G，从前是三个字）。和暂停、返回同一副圆盘画法，记号用 `var(--ctl-mark)` 画才会跟着页面变色 |
| `app-tower-rgb.svg` | 站点图标（标签页、手机主屏幕）。从前《更换图标》里有 11 个可挑，2026-10-08 那个入口删了，只剩这一个 |
| `daily-1.svg` … `daily-7.svg` | 主菜单最上面那张《每日挑战》（第 19 推），按北京时间的星期几换：1 周一玫瑰红、2 周二深灰、3 周三橙、4 周四紫、5 周五蓝、6 周六奶白、7 周日绿。**日期数字不在文件里**，是程序压上去的（`ui/dailyArt.ts`）。**这七个没有代码里画的底版**，删掉一个那一天就只剩一块纸色的底 |
| `login.svg` `close.svg` `mail.svg` `eye.svg` `eye-off.svg` | 帐号窗、邀请窗上那几颗只放图标的键（登录 / 关闭 / 联络 / 显示第一串 / 遮住第一串）。**这五个没有代码里画的底版**：删掉文件会让 `npm run build` 当场失败，而不是变回什么——见 `ui/uiIcons.ts` |

## 两件要知道的事

**`sound-on` / `sound-off` / `lock` / `ctl-pause` / `ctl-finish`，以及上面那五个线描
图标，现在是「跟着周围颜色走」的**（用 `currentColor` 和 CSS 变量画的），所以深色模式下会自己变
色，按钮按下去会反色。换成写死颜色的文件之后，这个跟随就没有了。这是取舍，
不是故障——如果你希望它们继续跟随，画的时候把填色写成 `currentColor`。

**换了 `app-tower-rgb.svg` 之后要重跑一次 `node scripts/gen-app-icons.mjs`**：手机
主屏幕装的是 PNG，是从这些 SVG 烤出来的，不重跑的话网页上换了、主屏幕上没换。

## 不在这里换的

棋盘上的棋子本身、得分图案的示意图，都不是图标——前者是游戏画面，后者是按
判分规则自动画出来的。示意图如果改成手画的文件，就和真正的判分脱钩了，之前
修过两次「图标和实际得分不一致」的 bug，不要再走回去。
