import type { Lang } from './i18n';

/**
 * The whole rulebook, in one place, in every language.
 *
 * It used to live as two long paragraphs under each board (hint +
 * assumptions), written once in Chinese and never translated — so every
 * non-Chinese player got a wall of Chinese under an otherwise translated
 * screen. Those paragraphs are gone: the rules are now one short, shared
 * list plus a line per mode, reachable from 个人主页 → 游戏规则 whenever a
 * player wants them, rather than sitting permanently under a board nobody
 * reads twice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-09 整本重写：《侵蚀阶梯》v1.2
 *
 * 上一本写的是上一套规则——连击倍率、时间系数、2×2 那一族块状图案、整组星星按
 * 平方算、有效得分率、0.95^未翻面。**这些在引擎里一样都不剩了**：得分图案只剩
 * 1×N 且会一路变小（engine/erosion.ts），每翻一枚 +2（engine/scoring.ts 的
 * POINTS_PER_FLIP），综合分只剩一个乘数（engine/stepCoef.ts）。
 *
 * 这本书不是介绍文案，是**对代码实际行为的陈述**——玩家照着它去凑一个不存在的
 * 图案、或者以为打快了有分，那不是「说明写得不够好」，是假话。每一条底下都注着
 * 它的出处文件；改那些文件的时候，回来把这本书一起改。
 *
 * 通用那五条和教学条那五条（i18n.ts 的 TUTORIAL_RULES，玩家 2026-09-27 亲笔）讲
 * 的是同一件事，只是这本书往下多说一层。两处的说法不许打架。
 */
export interface RuleItem {
  /** Short bold lead-in, e.g. "连击". */
  term: string;
  body: string;
}
export interface RuleBook {
  title: string;
  generalHeading: string;
  modesHeading: string;
  general: RuleItem[];
  modes: RuleItem[];
}

export const RULES: Record<Lang, RuleBook> = {
  zhHans: {
    title: '游戏规则',
    generalHeading: '通用规则',
    modesHeading: '各玩法的差别',
    general: [
      { term: '滑动与得分', body: '拖动一整条线，整条线一起循环移动，滑出去的从另一端补回来（方块拖整行整列；小球和三角还能沿两条斜线拖）。同色连成一线、而且里面至少有一枚色块，就算拼出了得分图案：图案里每翻一枚色块得 2 分，翻过去是一颗其他颜色的星星。' },
      { term: '得分图案会变小', body: '屏幕右上那块《得分图案》画的就是此刻要凑的那一条，开局是一线 4 枚。每翻一枚，它的边框就熄一段；段数用完，图案少一枚——4 → 3 → 2 → 1。三级的段数加起来正好是满盘的枚数，所以擦完最后一段和「全盘都翻成星星」是同一件事，那一下记一枚《解锁 1 枚》徽章。一步翻了好几枚、超出这一级剩下的段数时，多出来的结转到下一级接着扣，所以一步之内可能连降两级。' },
      { term: '消除', body: '经典方块：任何一整行或一整列都是同色星星，就得分并消掉，两侧滑动收拢补位。其余几副棋盘：托盘上那条浅色带标出的就是此刻的最外边——整条都是同色星星、而且至少 3 枚，就削掉，那些格子离场，剩下的部分整体放大。消掉一条得「星星数 × 星星数」分。一条边都削不动、而且怎么滑都再翻不动一枚色块的时候，门槛降到 1 枚，剩下的一条条自己削完。' },
      { term: '综合得分', body: '综合分 = 拼出分 × 步数系数，只此一个乘数。步数系数 =（基准步数 × 已清枚数 ÷ 满盘枚数 ÷ 实际步数）的平方，最低 ×1.00、没有上限：走得比基准少才加分，走得多也不倒扣。基准步数每副棋盘各有一个，结算页上和实际步数并排写着。时间不再参与计分，用时只在结算页上以一行小字出现。' },
      { term: '目标', body: '尽量少走步，把棋盘清干净。全部消光记一枚《清盘》徽章。也可以随时在暂停里点《完成》收工；再也凑不出任何得分图案时，这一局自动结算。' },
    ],
    modes: [
      { term: '经典方块', body: '6×6 共 36 枚，拖动整行或整列。只有这一副是整行整列消除：整行或整列都是同色星星就消掉，两侧滑动收拢补位。其余几副削的是最外边。' },
      { term: '菱形方块', body: '36 枚排成菱形，可沿水平和两条斜线拖动。它长得是方块，消除却和小球一路——削最外面的那一条线，不是整行整列。' },
      { term: '经典小球', body: '28 枚三角排布，三个方向都能拖。' },
      { term: '六边形小球', body: '37 枚六边形排布，棋盘正中心一开始就是空位，所以真正能用的是 36 格，基准步数也按 36 算。' },
      { term: '菱形小球', body: '49 枚菱形排布，7 种颜色各 7 枚——颜色最多的一副，基准步数也最高（86）。' },
      { term: '六边形三角', body: '54 枚，6 色各 9 枚，每行 7-9-11-11-9-7，上下对称，所以轮廓是六边形而不是实心三角。Slides 天才特供。' },
      { term: '炸弹玩法', body: '红块不参与配对，是障碍。得分图案旁边的炸弹挨两下才拆：第一下只留一道裂纹，第二下才翻成一颗普通颜色的星星——拆掉的这一枚和翻一枚色块完全一样，得 2 分，也熄一段。3 个红块相互边相连时会闪烁描边预警；一旦 4 个及以上相连，立即结束并扣 100 分，这一步的连锁全部走完之后才判。' },
      { term: '计时挑战', body: '计时挑战和定时炸弹都是 100 秒。时间一到立即结算。钟摆在暂停键正上方。这一档照常乘步数系数：钟决定这一局有多长，而同样一段时间里走得越少、清得越多，系数越高。' },
      { term: '老虎机模式', body: '只有方块和小球有，Slides 天才特供。开局那台老虎机转出一个得分图案，这一局只有它算分——这个玩法自己那条 1×N 不算。拼出来：图案里每翻一枚 2 分，另加「枚数 × 枚数 ÷ 2、向上取整」（3 枚 5 分、4 枚 8 分、5 枚 13 分、6 枚 18 分）。它也会变小：每降一级少一枚，最少剩一枚；少了之后，它任意还连着的那几枚都算。消除和棋盘一概不变。这一档不乘步数系数，排行榜也单独排一张。小屋里由屋主定全屋拼同一个图案还是各转各的（棋盘两种情况都一样）。' },
      { term: '无限反转', body: '固定 100 秒。星星得分会再翻回色块，所以同色星星永远不消除，一格都不会离场。这一局不吃侵蚀：段照扣，得分图案永远停在 4 枚——翻过去还能翻回来，再吃侵蚀的话几步就降到 1 枚、随便一枚都得分。不乘步数系数。' },
      { term: '真正解密 · 步步为营', body: '只有方块和小球有。开局手里 8 步，每走一步扣 1；这一步得分退回 1，上一步也得分再退 1，这一步削掉一条线再退 2，不封顶。没有时间限制。步数用完、或者能消的都消完就结算，用它自己那套公式：被消除 × 10 + 星星 × 5。不乘步数系数，也不乘有效得分率——步数在这一局本来就是资源，再乘一次等于罚两遍；而消了几枚、留下几颗星已经把这一局的本事说完了。' },
    ],
  },
  zhHant: {
    title: '遊戲規則',
    generalHeading: '通用規則',
    modesHeading: '各玩法的差別',
    general: [
      { term: '滑動與得分', body: '拖動一整條線，整條線一起循環移動，滑出去的從另一端補回來（方塊拖整行整列；小球和三角還能沿兩條斜線拖）。同色連成一線、而且裡面至少有一枚色塊，就算拼出了得分圖案：圖案裡每翻一枚色塊得 2 分，翻過去是一顆其他顏色的星星。' },
      { term: '得分圖案會變小', body: '螢幕右上那塊《得分圖案》畫的就是此刻要湊的那一條，開局是一線 4 枚。每翻一枚，它的邊框就熄一段；段數用完，圖案少一枚——4 → 3 → 2 → 1。三級的段數加起來正好是滿盤的枚數，所以擦完最後一段和「全盤都翻成星星」是同一件事，那一下記一枚《解鎖 1 枚》徽章。一步翻了好幾枚、超出這一級剩下的段數時，多出來的結轉到下一級接著扣，所以一步之內可能連降兩級。' },
      { term: '消除', body: '經典方塊：任何一整行或一整列都是同色星星，就得分並消掉，兩側滑動收攏補位。其餘幾副棋盤：托盤上那條淺色帶標出的就是此刻的最外邊——整條都是同色星星、而且至少 3 枚，就削掉，那些格子離場，剩下的部分整體放大。消掉一條得「星星數 × 星星數」分。一條邊都削不動、而且怎麼滑都再翻不動一枚色塊的時候，門檻降到 1 枚，剩下的一條條自己削完。' },
      { term: '綜合得分', body: '綜合分 = 拼出分 × 步數係數，只此一個乘數。步數係數 =（基準步數 × 已清枚數 ÷ 滿盤枚數 ÷ 實際步數）的平方，最低 ×1.00、沒有上限：走得比基準少才加分，走得多也不倒扣。基準步數每副棋盤各有一個，結算頁上和實際步數並排寫著。時間不再參與計分，用時只在結算頁上以一行小字出現。' },
      { term: '目標', body: '盡量少走步，把棋盤清乾淨。全部消光記一枚《清盤》徽章。也可以隨時在暫停裡點《完成》收工；再也湊不出任何得分圖案時，這一局自動結算。' },
    ],
    modes: [
      { term: '經典方塊', body: '6×6 共 36 枚，拖動整行或整列。只有這一副是整行整列消除：整行或整列都是同色星星就消掉，兩側滑動收攏補位。其餘幾副削的是最外邊。' },
      { term: '菱形方塊', body: '36 枚排成菱形，可沿水平和兩條斜線拖動。它長得是方塊，消除卻和小球一路——削最外面的那一條線，不是整行整列。' },
      { term: '經典小球', body: '28 枚三角排布，三個方向都能拖。' },
      { term: '六邊形小球', body: '37 枚六邊形排布，棋盤正中心一開始就是空位，所以真正能用的是 36 格，基準步數也按 36 算。' },
      { term: '菱形小球', body: '49 枚菱形排布，7 種顏色各 7 枚——顏色最多的一副，基準步數也最高（86）。' },
      { term: '六邊形三角', body: '54 枚，6 色各 9 枚，每行 7-9-11-11-9-7，上下對稱，所以輪廓是六邊形而不是實心三角。Slides 天才特供。' },
      { term: '炸彈玩法', body: '紅塊不參與配對，是障礙。得分圖案旁邊的炸彈挨兩下才拆：第一下只留一道裂紋，第二下才翻成一顆普通顏色的星星——拆掉的這一枚和翻一枚色塊完全一樣，得 2 分，也熄一段。3 個紅塊相互邊相連時會閃爍描邊預警；一旦 4 個及以上相連，立即結束並扣 100 分，這一步的連鎖全部走完之後才判。' },
      { term: '計時挑戰', body: '計時挑戰和定時炸彈都是 100 秒。時間一到立即結算。鐘擺在暫停鍵正上方。這一檔照常乘步數係數：鐘決定這一局有多長，而同樣一段時間裡走得越少、清得越多，係數越高。' },
      { term: '老虎機模式', body: '只有方塊和小球有，Slides 天才特供。開局那台老虎機轉出一個得分圖案，這一局只有它算分——這個玩法自己那條 1×N 不算。拼出來：圖案裡每翻一枚 2 分，另加「枚數 × 枚數 ÷ 2、向上取整」（3 枚 5 分、4 枚 8 分、5 枚 13 分、6 枚 18 分）。它也會變小：每降一級少一枚，最少剩一枚；少了之後，它任意還連著的那幾枚都算。消除和棋盤一概不變。這一檔不乘步數係數，排行榜也單獨排一張。小屋裡由屋主定全屋拼同一個圖案還是各轉各的（棋盤兩種情況都一樣）。' },
      { term: '無限反轉', body: '固定 100 秒。星星得分會再翻回色塊，所以同色星星永遠不消除，一格都不會離場。這一局不吃侵蝕：段照扣，得分圖案永遠停在 4 枚——翻過去還能翻回來，再吃侵蝕的話幾步就降到 1 枚、隨便一枚都得分。不乘步數係數。' },
      { term: '真正解密 · 步步為營', body: '只有方塊和小球有。開局手裡 8 步，每走一步扣 1；這一步得分退回 1，上一步也得分再退 1，這一步削掉一條線再退 2，不封頂。沒有時間限制。步數用完、或者能消的都消完就結算，用它自己那套公式：被消除 × 10 + 星星 × 5。不乘步數係數，也不乘有效得分率——步數在這一局本來就是資源，再乘一次等於罰兩遍；而消了幾枚、留下幾顆星已經把這一局的本事說完了。' },
    ],
  },
  en: {
    title: 'How to play',
    generalHeading: 'Core rules',
    modesHeading: 'What changes per mode',
    general: [
      { term: 'Sliding and scoring', body: 'Drag a whole line. It moves as one and wraps around: whatever slides off one end comes back on the other. (Squares drag by row and column; balls and triangles also drag along two diagonals.) One unbroken line of a single colour holding at least one coloured piece is a scoring shape: every coloured piece it flips pays 2 points and turns into a star of another colour.' },
      { term: 'The scoring shape gets shorter', body: 'The Scoring shape block at the top right draws the line you are looking for right now — four pieces at the start. Every flip puts out one segment of its border; when the segments run out the shape loses a piece: 4 → 3 → 2 → 1. The three levels hold exactly as many segments as the board holds pieces, so putting out the last segment and flipping the whole board are the same event, and that moment earns the Unlocked 1 badge. A move that flips more pieces than the level has segments left carries the remainder into the next level, so a single move can drop two levels.' },
      { term: 'Clearing', body: 'Classic Squares: any whole row or column made of same-colour stars scores and clears, and the tiles on both sides slide in to close the gap. Every other board: the pale band on the tray marks the outermost line as it stands right now — when that whole line is same-colour stars and at least 3 of them, it is shaved off, those cells leave the board, and what is left grows to fill the board. A cleared line pays the star count squared. When no edge can be shaved and no slide can flip another coloured piece, the threshold drops to 1 and the rest peels away line by line on its own.' },
      { term: 'Final score', body: 'Final score = shape points × move factor, and that is the only multiplier. The move factor is ((par moves × pieces cleared ÷ pieces on the board) ÷ moves actually made) squared, floored at ×1.00 with no ceiling: coming in under par pays, going over never costs. Each board has its own par, printed next to your move count on the results screen. Time no longer counts towards the score — the clock only appears there as one small line.' },
      { term: 'The goal', body: 'Use as few moves as you can and clear the board. Clearing it completely earns the Swept badge. You can also finish any time from the pause panel; when no scoring shape is possible anywhere, the run scores itself.' },
    ],
    modes: [
      { term: 'Classic Squares', body: '36 tiles in a 6×6 grid; drag a whole row or column. This is the only board that clears by row and column: a whole row or column of same-colour stars clears and the tiles on both sides close the gap. Every other board shaves its outer edge instead.' },
      { term: 'Diamond Squares', body: '36 tiles in a diamond; drag horizontally or along either diagonal. It looks like a square board but clears like the ball boards — the outermost line, not a whole row.' },
      { term: 'Classic Balls', body: '28 balls in a triangle, draggable in three directions.' },
      { term: 'Hex Balls', body: '37 balls in a hexagon, with the very centre empty from the start, so 36 cells are actually in play and par is worked out from 36.' },
      { term: 'Diamond Balls', body: '49 balls in a diamond, 7 colours of 7 — the most colours of any board, and the highest par (86).' },
      { term: 'Hex Triangles', body: '54 tiles, 6 colours with 9 each, in rows of 7-9-11-11-9-7. It is symmetric top to bottom, so the outline is a hexagon rather than a solid triangle. Slides genius only.' },
      { term: 'Bomb modes', body: 'Red tiles never match — they are obstacles. A bomb next to a scoring shape takes two hits to defuse: the first only cracks it, the second turns it into an ordinary-coloured star — and that defused piece counts exactly like any flipped piece, paying 2 points and putting out one segment. Three reds edge-to-edge start pulsing as a warning; four or more connected ends the run at once with a 100-point penalty, judged once the move’s whole chain has played out.' },
      { term: 'Timed modes', body: 'Timed challenge and timed bomb both run 100 seconds. The run scores the moment the clock runs out. The clock sits directly above the pause button. These do take the move factor: the clock decides how long a run is, and within that time fewer moves and more cleared pieces mean a higher factor.' },
      { term: 'Slot machine mode', body: 'Squares and balls only, for Slides geniuses. The slot machine on the start screen draws one scoring shape, and that shape is the only thing that scores this run — the 1×N line the board normally scores does not count. Build it: 2 points for every piece turned, plus pieces × pieces ÷ 2 rounded up (5 for three, 8 for four, 13 for five, 18 for six). It shrinks too: one piece fewer at each step of the ladder, down to a single piece, and from then on any still-joined part of it counts. Clearing and the board are unchanged. This mode takes no move factor, and it has a leaderboard of its own. In a room the host decides whether everyone builds the same shape or each device spins its own (the board is identical either way).' },
      { term: 'Endless flip', body: 'A fixed 100 seconds. A star that scores flips straight back into a coloured piece, so same-colour stars never clear and no cell ever leaves the board. This mode takes no erosion: segments still burn, but the scoring shape stays at four pieces all game — pieces can be flipped back, and with erosion it would drop to one within a few moves and anything at all would score. No move factor either.' },
      { term: 'Puzzle · Step by step', body: 'Only squares and balls have it. You start with eight moves; every move costs one. A move that scores pays one back, +1 more if the move before it also scored, +2 more if it shaved a line — no cap. No clock. The run ends when the moves run out or the board is finished, and scores by its own formula: cleared × 10 + stars × 5. No move factor and no hit-rate bonus — moves are this mode’s resource already, and multiplying by them again would punish twice; what you cleared and the stars you left have already said the rest.' },
    ],
  },
  fr: {
    title: 'Règles du jeu',
    generalHeading: 'Règles générales',
    modesHeading: 'Ce qui change selon le mode',
    general: [
      { term: 'Glisser et marquer', body: 'Faites glisser une ligne entière. Elle se déplace d’un bloc et boucle : ce qui sort d’un côté revient de l’autre. (Les carrés glissent par rangée et colonne ; les billes et les triangles glissent aussi sur deux diagonales.) Une ligne ininterrompue d’une seule couleur contenant au moins une pièce colorée est un motif qui marque : chaque pièce colorée retournée rapporte 2 points et devient une étoile d’une autre couleur.' },
      { term: 'Le motif raccourcit', body: 'Le bloc Motif à former, en haut à droite, dessine la ligne à composer à cet instant — quatre pièces au départ. Chaque retournement éteint un segment de sa bordure ; quand les segments sont épuisés, le motif perd une pièce : 4 → 3 → 2 → 1. Les trois niveaux comptent exactement autant de segments que le plateau compte de pièces : éteindre le dernier segment et retourner tout le plateau sont donc le même évènement, et ce moment vaut le badge Débloqué 1. Un coup qui retourne plus de pièces que le niveau n’a de segments reporte le reste sur le niveau suivant : un seul coup peut donc faire descendre de deux niveaux.' },
      { term: 'Éliminer', body: 'Carrés classiques : toute rangée ou colonne entièrement faite d’étoiles d’une même couleur marque et disparaît, et les pièces des deux côtés se resserrent. Tous les autres plateaux : la bande claire sur le plateau marque la ligne la plus externe à cet instant — quand elle est entièrement faite d’étoiles de même couleur, au moins 3, elle est rasée, ces cases quittent le plateau et ce qui reste s’agrandit pour remplir le plateau. Une ligne éliminée rapporte le nombre d’étoiles au carré. Quand plus aucun bord ne peut être rasé et qu’aucun glissement ne retourne plus de pièce colorée, le seuil tombe à 1 et le reste s’efface ligne par ligne tout seul.' },
      { term: 'Score final', body: 'Score final = points des motifs × facteur de coups, et c’est le seul multiplicateur. Le facteur de coups vaut ((coups de référence × pièces éliminées ÷ pièces du plateau) ÷ coups réellement joués) au carré, plancher à ×1,00 et sans plafond : jouer sous la référence rapporte, jouer au-dessus ne coûte rien. Chaque plateau a sa propre référence, affichée à côté de votre nombre de coups sur l’écran de score. Le temps ne compte plus dans le score : il n’y apparaît que sur une petite ligne.' },
      { term: 'L’objectif', body: 'Jouez le moins de coups possible et videz le plateau. Le vider entièrement vaut le badge Plateau net. Vous pouvez aussi terminer à tout moment depuis la pause ; quand plus aucun motif n’est possible, la partie se conclut d’elle-même.' },
    ],
    modes: [
      { term: 'Carrés classiques', body: '36 pièces en grille 6×6 ; on fait glisser une rangée ou une colonne entière. C’est le seul plateau qui élimine par rangée et colonne : une rangée ou colonne entièrement faite d’étoiles de même couleur disparaît et les pièces des deux côtés se resserrent. Tous les autres rasent leur bord extérieur.' },
      { term: 'Carrés losange', body: '36 pièces en losange, glissables à l’horizontale et sur les deux diagonales. Il ressemble à un plateau de carrés mais élimine comme les billes — la ligne la plus externe, pas une rangée entière.' },
      { term: 'Billes classiques', body: '28 billes en triangle, trois directions.' },
      { term: 'Billes hexagone', body: '37 billes en hexagone, le centre vide dès le départ : 36 cases sont réellement en jeu et la référence est calculée sur 36.' },
      { term: 'Billes losange', body: '49 billes en losange, 7 couleurs de 7 — le plateau qui a le plus de couleurs, et la référence la plus haute (86).' },
      { term: 'Triangles hexagone', body: '54 pièces, 6 couleurs à 9 pièces chacune, en rangées de 7-9-11-11-9-7. Le plateau est symétrique de haut en bas, donc le contour est un hexagone et non un triangle plein. Réservé aux génies de Slides.' },
      { term: 'Modes bombe', body: 'Les pièces rouges ne s’associent jamais : ce sont des obstacles. Une bombe voisine d’un motif qui marque se désamorce en deux coups : le premier ne fait que la fissurer, le second la change en étoile de couleur ordinaire — et cette pièce désamorcée compte exactement comme une pièce retournée : 2 points, et un segment éteint. Trois rouges bord à bord se mettent à clignoter en avertissement ; quatre ou plus connectées terminent la partie sur-le-champ avec 100 points de pénalité, jugées une fois toute la réaction en chaîne du coup terminée.' },
      { term: 'Modes chronométrés', body: 'Le défi chronométré et la bombe chronométrée durent tous deux 100 secondes. Le score tombe dès la fin du temps. Le chronomètre se place juste au-dessus du bouton pause. Ces modes appliquent bien le facteur de coups : le chronomètre décide de la durée, et dans ce temps, moins de coups et plus de pièces effacées donnent un facteur plus élevé.' },
      { term: 'Mode machine à sous', body: 'Réservé aux carrés et aux billes, pour les génies de Slides. La machine à sous de l’écran de départ tire une figure gagnante, et cette seule figure marque pendant la partie : la ligne 1×N habituelle du plateau ne rapporte rien. Formez-la : 2 points par pièce retournée, plus pièces × pièces ÷ 2 arrondi au supérieur (5 pour trois, 8 pour quatre, 13 pour cinq, 18 pour six). Elle rétrécit aussi : une pièce de moins à chaque palier, jusqu’à une seule, et toute partie encore reliée compte alors. Les disparitions et le plateau ne changent pas. Ce mode n’a pas de facteur de coups, et il a son propre classement. Dans un salon, l’hôte décide si tout le monde forme la même figure ou si chaque appareil tire la sienne (le plateau est identique dans les deux cas).' },
      { term: 'Retournement infini', body: '100 secondes fixes. Une étoile qui marque redevient aussitôt une pièce colorée : les étoiles de même couleur ne disparaissent donc jamais et aucune case ne quitte le plateau. Ce mode ne subit pas l’érosion : les segments s’éteignent quand même, mais le motif reste à quatre pièces toute la partie — les pièces peuvent être retournées dans les deux sens, et avec l’érosion il tomberait à une pièce en quelques coups et n’importe quoi marquerait. Pas de facteur de coups non plus.' },
      { term: 'Énigme · Pas à pas', body: 'Réservé aux carrés et aux billes. Vous commencez avec huit coups ; chaque coup en coûte un. Un coup qui marque en rend un, +1 de plus si le coup précédent a marqué aussi, +2 de plus s’il a rasé une ligne — sans plafond. Pas de chronomètre. La partie s’arrête quand les coups sont épuisés ou que le plateau est fini, et marque selon sa propre formule : éliminées × 10 + étoiles × 5. Ni facteur de coups, ni bonus de taux de réussite — les coups sont déjà la ressource de ce mode, les compter deux fois punirait deux fois ; ce que vous avez éliminé et les étoiles laissées en disent déjà le reste.' },
    ],
  },
};
