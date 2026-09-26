/**
 * 三个纯函数，给 Kinetics 那一批手感件各守一条判定。
 *
 * 为什么单独一个文件、而且一个依赖都不引：这三条各自守着一件「错了不报错」的
 * 事，所以要有门；而门（scripts/check-kinetics.mjs）是 esbuild 打包这一个文件
 * 然后直接跑的——引了 i18n 或者任何摸 DOM 的东西，门就得连整个应用一起打包，
 * 那样的门慢到最后没人跑（和 engine/axisMotion.ts 一个道理）。
 */

/**
 * 「全部方块已翻成点面」——真通关那一个终局原因。
 *
 * 这一句从前是 gameController 里一个裸字符串，runRecord 的查表里又抄了一遍。
 * 两处对不上的时候没人会发现：终局照样结束、榜照样上，只是那一局的原因翻译不
 * 出来（displayReason 找不到键就原样印中文），或者——现在——通关那枚勾不出现。
 * 所以把它提到这儿，两处都 import 同一个常量。
 */
export const ALL_FLIPPED_REASON = '全部方块已翻成点面';

/**
 * 这一局的终局配不配那枚通关勾。
 *
 * 只有真的把所有方块翻成点面才算。**别的五种都不算**，而且各有各的理由：
 *
 *   时间到          —— 钟响了，不是他赢了
 *   无法继续匹配    —— 棋盘走死了
 *   炸弹            —— 他被炸出去的
 *   手动结束        —— 他自己按的《结束》
 *   步数用尽        —— 步步为营那一路的步数光了
 *
 * 一枚「完成」的勾盖在这五种上头就是在骗人，而这枚勾要值钱，只能靠它不乱盖。
 */
export function endCheckEligible(reason: string): boolean {
  return reason === ALL_FLIPPED_REASON;
}

/**
 * 粘进验证码框的那一段，洗成能落格的数字串。
 *
 * 码是从聊天软件里复制来的，带的东西五花八门：前后空格、中间的空格、连字符、
 * 「验证码：」那三个字、甚至整句话。人肉挑数字是这个框存在的全部意义的反面，
 * 所以这儿一律去掉非数字、取前 max 位。
 *
 * 取「前」几位而不是「后」几位：从前面数才对得上他读到的顺序。
 */
export function splitPastedCode(raw: string, max = 6): string {
  return raw.replace(/\D+/g, '').slice(0, max);
}

/**
 * 六位密码填了几位——给输入框底下那六小段用。
 *
 * 不是强度表，是完成度表：密码策略正好六位（api/_accounts.js 和 subscribe.ts 的
 * isPin 是同一条正则），定长的东西谈不上强弱，四档强度表摆在这儿是自相矛盾的
 * 仪表。它回答的是唯一还没答案的那个问题：「我打了几位了？」
 *
 * 钳制两头：负数回 0（不该发生，但 selectionStart 那一带的算术出过负数），
 * 超过六位回 6（maxlength 挡得住手打，挡不住粘贴和输入法）。
 */
export function meterFill(len: number): number {
  if (!Number.isFinite(len)) return 0;
  return Math.max(0, Math.min(6, Math.floor(len)));
}
