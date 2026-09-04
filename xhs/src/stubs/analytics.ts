/**
 * 统计层的空替身。
 *
 * 小工具不联网（见 .claude/skills/minitool-zip-builder/references/
 * device-capabilities.md 的「不可用行为」），Vercel Analytics 和 GA4 那两个
 * 域名一个都够不着；就算够得着，往笔记里挂的小工具偷偷发统计也不合适。
 *
 * 所以这一版把整个统计层换成空函数——不是删掉调用点。调用点留在
 * gameController、shapes 里原样不动，那是「完全复刻」的一部分：网页版以后
 * 加一处统计，这边自动跟上，不用记得来补。换掉的只是它落地的地方。
 *
 * 换法见 xhs/vite.config.ts 的 resolve.alias。
 */
export function report(_name: string, _props: Record<string, unknown> = {}): void {}
export function initAnalytics(_lang: string): void {}
export function trackScreen(_screen: string): void {}
export function trackGameStart(_shape: string, _mode: string): void {}
export function trackGameEnd(_e: Record<string, unknown>): void {}
export function trackTutorialStart(_shape: string): void {}
export function trackTutorialEnd(..._args: unknown[]): void {}
export function trackLanguage(_lang: string, _source: 'auto' | 'switch'): void {}
export function trackShare(_source: string): void {}
export function trackIconChange(_icon: string): void {}
