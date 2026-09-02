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
      { term: '滑动', body: '拖动一整条线，整条线一起循环移动，滑出棋盘的部分从另一端补回来。' },
      { term: '得分', body: '一条线上连续 4 个同色（不分正反面）得 4 分，连得更长按实际枚数得分。每种玩法还有自己的块状图案，见下。' },
      { term: '必须有正面', body: '得分图案至少要含 1 个仍是正面的块。全都已经翻成点面的图案不再得分，所以把同一组反复滑回原样是刷不到分的。' },
      { term: '翻面', body: '得分的块翻到点面（反面），之后按点色继续参与配对。' },
      { term: '整线奖励', body: '一整条线（长度 ≥3）全部翻成点面且点色相同时，额外得「线长 × 线长」分，该线随后消除或变成空白。' },
      { term: '连击', body: '连续多步得分依次 ×1、×1.5、×2、×2.5……每多连一步就多 0.5 倍；某一步没得分就从 ×1 重新开始。' },
      { term: '结束', body: '所有块都翻成点面或变空白时自动结束，也可以随时点《结束》。当某个颜色确定再也翻不了面时，《自行结束》会亮起提醒你。' },
      { term: '综合得分', body: '得分 × 时间系数 × (1 + 有效得分率) × 0.95^未翻面块数。时间系数 = 2 − 用时秒数 ÷ 300，限制在 0.5～2 之间（多人房间里这一项的作用放大 1.5 倍，也就是 0.25～2.5——同一副牌大家一起打，快慢本身就是比的东西）；有效得分率 = 整局累计的得分行动 ÷ 总行动（普通图案算 1 个行动、超过 4 枚的图案算 2 个、整线消除算 3 个）。' },
    ],
    modes: [
      { term: '方块', body: '6×6 共 36 枚，拖动整行或整列。图案：1×4 / 4×1、2×2。整行或整列消除后，两侧的方块滑动收拢补位。' },
      { term: '菱形方块', body: '36 枚排成菱形，可沿水平和两条斜线拖动。图案：1×4、2+2（同一排相邻 2 个，加上下一排错开半格的 2 个，左右两种错法都算）、1-2-1。' },
      { term: '圆球', body: '21 枚三角排布，三个方向都能拖。图案：1×4、2+2 菱形、121 菱形。整线消除后变成空白球留在原位，还能被拖动和补位，但不再得分。' },
      { term: '六边圆球', body: '37 枚六边形排布，棋盘正中心一开始就是空白球。图案与圆球相同。' },
      { term: '七色圆球', body: '49 枚菱形排布，7 种颜色各 7 枚。图案：1×4、2+2。' },
      { term: '三角', body: '54 枚，三个方向。图案：1×4、大三角（3 个同朝向 + 1 个反朝向）。三角的朝向由格子决定，拖动会吸附到偶数格以保住朝向；发牌时每种颜色在朝上、朝下两种格子上都是均衡的，所以不会出现永远拼不出图案的颜色。' },
      { term: '大三角', body: '25 枚拼成一个实心大三角，规则与基础三角相同。' },
      { term: '进阶三角', body: '49 枚排成 V 形，7 色各 7 枚，没有任何一枚的正反面是同一种颜色。除最下面一行横贯整块外，左右两臂的横向拖动互不相连。' },
      { term: '炸弹玩法', body: '红块永不翻面，也不参与配对，只是障碍。3 个红块相互边相连时会闪烁描边预警；一旦 4 个及以上相连，立即结束并扣 100 分。' },
      { term: '计时挑战', body: '计时挑战 60 秒，定时炸弹 90 秒，时间一到立即结算。' },
    ],
  },
  zhHant: {
    title: '遊戲規則',
    generalHeading: '通用規則',
    modesHeading: '各玩法的差別',
    general: [
      { term: '滑動', body: '拖動一整條線，整條線一起循環移動，滑出棋盤的部分從另一端補回來。' },
      { term: '得分', body: '一條線上連續 4 個同色（不分正反面）得 4 分，連得更長按實際枚數得分。每種玩法還有自己的塊狀圖案，見下。' },
      { term: '必須有正面', body: '得分圖案至少要含 1 個仍是正面的塊。全都已經翻成點面的圖案不再得分，所以把同一組反覆滑回原樣是刷不到分的。' },
      { term: '翻面', body: '得分的塊翻到點面（反面），之後按點色繼續參與配對。' },
      { term: '整線獎勵', body: '一整條線（長度 ≥3）全部翻成點面且點色相同時，額外得「線長 × 線長」分，該線隨後消除或變成空白。' },
      { term: '連擊', body: '連續多步得分依次 ×1、×1.5、×2、×2.5……每多連一步就多 0.5 倍；某一步沒得分就從 ×1 重新開始。' },
      { term: '結束', body: '所有塊都翻成點面或變空白時自動結束，也可以隨時點《結束》。當某個顏色確定再也翻不了面時，《自行結束》會亮起提醒你。' },
      { term: '綜合得分', body: '得分 × 時間係數 × (1 + 有效得分率) × 0.95^未翻面塊數。時間係數 = 2 − 用時秒數 ÷ 300，限制在 0.5～2 之間（多人房間裡這一項的作用放大 1.5 倍，也就是 0.25～2.5——同一副牌大家一起打，快慢本身就是比的東西）；有效得分率 = 整局累計的得分行動 ÷ 總行動（普通圖案算 1 個行動、超過 4 枚的圖案算 2 個、整線消除算 3 個）。' },
    ],
    modes: [
      { term: '方塊', body: '6×6 共 36 枚，拖動整行或整列。圖案：1×4 / 4×1、2×2。整行或整列消除後，兩側的方塊滑動收攏補位。' },
      { term: '菱形方塊', body: '36 枚排成菱形，可沿水平和兩條斜線拖動。圖案：1×4、2+2（同一排相鄰 2 個，加上下一排錯開半格的 2 個，左右兩種錯法都算）、1-2-1。' },
      { term: '圓球', body: '21 枚三角排布，三個方向都能拖。圖案：1×4、2+2 菱形、121 菱形。整線消除後變成空白球留在原位，還能被拖動和補位，但不再得分。' },
      { term: '六邊圓球', body: '37 枚六邊形排布，棋盤正中心一開始就是空白球。圖案與圓球相同。' },
      { term: '七色圓球', body: '49 枚菱形排布，7 種顏色各 7 枚。圖案：1×4、2+2。' },
      { term: '三角', body: '54 枚，三個方向。圖案：1×4、大三角（3 個同朝向 + 1 個反朝向）。三角的朝向由格子決定，拖動會吸附到偶數格以保住朝向；發牌時每種顏色在朝上、朝下兩種格子上都是均衡的，所以不會出現永遠拼不出圖案的顏色。' },
      { term: '大三角', body: '25 枚拼成一個實心大三角，規則與基礎三角相同。' },
      { term: '進階三角', body: '49 枚排成 V 形，7 色各 7 枚，沒有任何一枚的正反面是同一種顏色。除最下面一行橫貫整塊外，左右兩臂的橫向拖動互不相連。' },
      { term: '炸彈玩法', body: '紅塊永不翻面，也不參與配對，只是障礙。3 個紅塊相互邊相連時會閃爍描邊預警；一旦 4 個及以上相連，立即結束並扣 100 分。' },
      { term: '計時挑戰', body: '計時挑戰 60 秒，定時炸彈 90 秒，時間一到立即結算。' },
    ],
  },
  en: {
    title: 'How to play',
    generalHeading: 'Core rules',
    modesHeading: 'What changes per mode',
    general: [
      { term: 'Sliding', body: 'Drag a whole line. It moves as one and wraps around: whatever slides off one end comes back on the other.' },
      { term: 'Scoring', body: 'Four in a row of the same colour (face or dot side, either counts) scores 4. A longer run scores its actual length. Each mode adds its own block patterns — see below.' },
      { term: 'Needs a face-up tile', body: 'A scoring pattern must contain at least one tile still showing its colour face. A pattern made entirely of dot faces never scores, so sliding the same group back into shape cannot farm points.' },
      { term: 'Flipping', body: 'Tiles that score flip to their dot face and keep playing, now matching on their dot colour.' },
      { term: 'Full-line bonus', body: 'When a whole line (3 or longer) is all dot-faced in one dot colour, it pays its length squared, then clears or turns blank.' },
      { term: 'Streak', body: 'Consecutive scoring moves pay ×1, ×1.5, ×2, ×2.5 and so on — half a multiplier more each time. One move without a score resets it to ×1.' },
      { term: 'Ending', body: 'The run ends when every tile is dot-faced or blank; you can also stop any time with End. When a colour provably can never flip again, the "Stop here" button lights up to tell you.' },
      { term: 'Final score', body: 'points × time factor × (1 + hit rate) × 0.95 per never-flipped tile. Time factor = 2 − seconds ÷ 300, clamped to 0.5–2 — in a multiplayer room its pull is 1.5× as strong (0.25–2.5), because when everyone shares one board, speed is the thing being raced. Hit rate = scoring actions ÷ total actions over the whole run (an ordinary pattern counts 1, one grown past 4 tiles counts 2, a full-line clear counts 3).' },
    ],
    modes: [
      { term: 'Squares', body: '36 tiles in a 6×6 grid; drag a whole row or column. Patterns: 1×4 / 4×1 and 2×2. A cleared row or column disappears and the tiles on both sides slide in to close the gap.' },
      { term: 'Diamond squares', body: '36 tiles in a diamond; drag horizontally or along either diagonal. Patterns: 1×4; 2+2 (two neighbours in one row plus two more half a tile over in the next, mirrored either way); 1-2-1.' },
      { term: 'Balls', body: '21 balls in a triangle, draggable in three directions. Patterns: 1×4, the 2+2 rhombus, the 121 rhombus. A cleared line turns blank and stays on the board — still draggable, but worth nothing.' },
      { term: 'Hex balls', body: '37 balls in a hexagon, with the very centre blank from the start. Same patterns as Balls.' },
      { term: 'Seven-colour balls', body: '49 balls in a diamond, 7 colours of 7. Patterns: 1×4 and 2+2.' },
      { term: 'Triangles', body: '54 tiles, three directions. Patterns: 1×4 and the big triangle (3 facing one way plus 1 facing the other). A triangle\'s orientation belongs to its slot, and dragging snaps to even steps to preserve it — so the deal gives every colour an even share of up- and down-slots, and no colour can be left unable to ever match.' },
      { term: 'Big triangle', body: '25 tiles forming one solid triangle. Same rules as Triangles.' },
      { term: 'Advanced triangle', body: '49 tiles in a V, 7 colours of 7, and no tile has the same colour on both faces. Except for the bottom row, which spans the whole board, the left and right arms slide independently of each other.' },
      { term: 'Bomb modes', body: 'Red tiles never flip and never match — they are pure obstacles. Three of them edge-to-edge start pulsing as a warning; four or more connected ends the run at once with a 100-point penalty.' },
      { term: 'Timed modes', body: 'Timed challenge runs 60 seconds, timed bomb 90. The run scores the moment the clock runs out.' },
    ],
  },
  fr: {
    title: 'Règles du jeu',
    generalHeading: 'Règles générales',
    modesHeading: 'Ce qui change selon le mode',
    general: [
      { term: 'Glisser', body: 'Faites glisser une ligne entière. Elle se déplace d\'un bloc et boucle : ce qui sort d\'un côté revient de l\'autre.' },
      { term: 'Marquer', body: 'Quatre pièces de la même couleur à la suite (face ou revers, peu importe) valent 4 points ; une suite plus longue vaut sa longueur réelle. Chaque mode ajoute ses propres motifs compacts — voir plus bas.' },
      { term: 'Une face visible obligatoire', body: 'Un motif ne marque que s\'il contient au moins une pièce encore côté couleur. Un motif entièrement retourné ne rapporte rien : refaire glisser le même groupe ne permet donc pas de farmer des points.' },
      { term: 'Retournement', body: 'Les pièces qui marquent passent côté point et continuent de jouer, en s\'associant désormais par leur couleur de point.' },
      { term: 'Bonus de ligne', body: 'Quand une ligne entière (3 ou plus) est retournée dans une seule couleur de point, elle rapporte sa longueur au carré, puis disparaît ou devient vierge.' },
      { term: 'Série', body: 'Les coups gagnants consécutifs valent ×1, ×1,5, ×2, ×2,5… soit un demi-multiplicateur de plus à chaque fois. Un coup sans point remet la série à ×1.' },
      { term: 'Fin de partie', body: 'La partie se termine quand toutes les pièces sont retournées ou vierges ; vous pouvez aussi arrêter à tout moment. Quand une couleur ne peut plus jamais être retournée, le bouton « Arrêter ici » s\'allume pour vous prévenir.' },
      { term: 'Score final', body: 'points × facteur temps × (1 + taux de réussite) × 0,95 par pièce jamais retournée. Facteur temps = 2 − secondes ÷ 300, borné entre 0,5 et 2 — en salle multijoueur son effet est 1,5× plus fort (0,25 à 2,5) : sur un plateau partagé, la vitesse est précisément ce qui se joue. Taux de réussite = actions payantes ÷ actions totales sur toute la partie (un motif ordinaire compte 1, un motif étendu au-delà de 4 pièces compte 2, une ligne entière compte 3).' },
    ],
    modes: [
      { term: 'Carrés', body: '36 pièces en grille 6×6 ; on fait glisser une rangée ou une colonne entière. Motifs : 1×4 / 4×1 et 2×2. Une rangée ou colonne éliminée disparaît et les pièces des deux côtés se resserrent.' },
      { term: 'Carrés en losange', body: '36 pièces en losange, glissables à l\'horizontale et sur les deux diagonales. Motifs : 1×4 ; 2+2 (deux voisines sur une rangée plus deux autres décalées d\'une demi-case sur la suivante, dans les deux sens) ; 1-2-1.' },
      { term: 'Billes', body: '21 billes en triangle, trois directions. Motifs : 1×4, le losange 2+2, le losange 121. Une ligne éliminée devient vierge et reste en place : encore déplaçable, mais sans valeur.' },
      { term: 'Billes hexagonales', body: '37 billes en hexagone, avec le centre vierge dès le départ. Mêmes motifs que les Billes.' },
      { term: 'Billes sept couleurs', body: '49 billes en losange, 7 couleurs de 7. Motifs : 1×4 et 2+2.' },
      { term: 'Triangles', body: '54 pièces, trois directions. Motifs : 1×4 et le grand triangle (3 dans un sens plus 1 dans l\'autre). L\'orientation d\'un triangle appartient à sa case et le glissement s\'aimante sur les pas pairs pour la préserver — la distribution donne donc à chaque couleur une part égale de cases vers le haut et vers le bas, pour qu\'aucune couleur ne devienne impossible à associer.' },
      { term: 'Grand triangle', body: '25 pièces formant un seul grand triangle plein. Mêmes règles que les Triangles.' },
      { term: 'Triangle avancé', body: '49 pièces en V, 7 couleurs de 7, et aucune pièce n\'a la même couleur des deux côtés. Sauf la rangée du bas, qui traverse tout le plateau, les deux bras glissent indépendamment l\'un de l\'autre.' },
      { term: 'Modes bombe', body: 'Les pièces rouges ne se retournent jamais et ne s\'associent jamais : ce sont de purs obstacles. Trois d\'entre elles bord à bord se mettent à clignoter en avertissement ; quatre ou plus connectées terminent la partie sur-le-champ avec 100 points de pénalité.' },
      { term: 'Modes chronométrés', body: 'Le défi chronométré dure 60 secondes, la bombe chronométrée 90. Le score tombe dès la fin du temps.' },
    ],
  },
};
