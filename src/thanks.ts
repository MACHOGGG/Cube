/**
 * 特别感谢名单。
 *
 * 加人只改这一个数组，别的地方一个字都不用动——《联系与特别感谢》那扇窗按它渲染，门按
 * `THANKS.length` 数那一屏上有几个名字（scripts/check-contact-thanks.mjs）。
 *
 * **人名不进 i18n**：四种语言共用同一份，名字不翻译。顺序就是数组顺序，没有排序逻辑——
 * 按字母排会把中文名和拉丁名分成两堆，而这不是一张榜。
 */
export const THANKS: readonly string[] = [
  'Zoey Kang',
  'Sichuang Fan',
  '林衍竹',
  'Apple Chen',
  'Dray',
];
