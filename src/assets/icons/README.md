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

## 清单

| 文件名 | 是哪个 |
|---|---|
| `base-square.svg` `base-circle.svg` `base-triangle.svg` | 主菜单最上面三个基础玩法 |
| `timed-combined.svg` | 手机主菜单上那支合体秒表 |
| `timed-square.svg` `timed-circle.svg` `timed-triangle.svg` | 电脑端和弹窗里的三支秒表 |
| `timed.svg` | 偷懒写法：三支一起换成同一张 |
| `bomb-90s.svg` | 90s 星爆。**画布是 260×100，不是正方形** |
| `bomb-basic-*.svg` `bomb-timed-*.svg` `bomb-advanced-*.svg` | 炸弹卡片里的九个小图标（`*` 是 square/circle/triangle） |
| `bomb-square.svg` 等三个 | 偷懒写法：三档共用同一套形状 |
| `more-square.svg` `more-circle.svg` `more-triangle.svg` | 「更多布局」的三张「+」卡 |
| `more.svg` | 偷懒写法：三张一起换 |
| `layout-squareDiamond.svg` `layout-circleHex.svg` `layout-circleSeven.svg` `layout-triangleBig.svg` `layout-triangleAdvanced.svg` | 五个具体布局。**triangleAdvanced 是 2:1 的宽画布** |
| `nav-profile.svg` `nav-records.svg` | 底部导航两颗 |
| `sound-on.svg` `sound-off.svg` | 个人主页的声音开关 |
| `lock.svg` | 未解锁内容旁边的小锁 |
| `slot-machine-menu.svg` | 主菜单上《随机得分目标》那张老虎机（窗口里画着三个符号） |
| `slot-machine.svg` | 开局时真的转起来的那台（两个窗口）。**画布 897×521**，滚筒窗口的位置在 `slotReels.ts` 里按它量 |
| `ctl-pause.svg` `ctl-finish.svg` | 游戏进行中的暂停 / 完成 |
| `app-tower-rgb.svg` 等 11 个 | 《更换图标》里的 11 个。名字是 `app-` 加上清单里的 id |

## 两件要知道的事

**`sound-on` / `sound-off` / `lock` / `ctl-pause` / `ctl-finish` 现在是「跟着
周围颜色走」的**（用 `currentColor` 和 CSS 变量画的），所以深色模式下会自己变
色，按钮按下去会反色。换成写死颜色的文件之后，这个跟随就没有了。这是取舍，
不是故障——如果你希望它们继续跟随，画的时候把填色写成 `currentColor`。

**换了 `app-*.svg` 之后要重跑一次 `node scripts/gen-app-icons.mjs`**：手机
主屏幕装的是 PNG，是从这些 SVG 烤出来的，不重跑的话网页上换了、主屏幕上没换。

## 不在这里换的

棋盘上的棋子本身、得分图案的示意图，都不是图标——前者是游戏画面，后者是按
判分规则自动画出来的。示意图如果改成手画的文件，就和真正的判分脱钩了，之前
修过两次「图标和实际得分不一致」的 bug，不要再走回去。
