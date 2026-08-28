export type BombTier = 'basic' | 'timed' | 'advanced';

export const BOMB_TIER_META: Record<BombTier, { title: string; tagline: string }> = {
  basic: { title: '基础炸弹', tagline: '红色为危险色 · 4 个相连即结束' },
  timed: { title: '定时炸弹', tagline: '基础炸弹规则 · 90 秒倒计时' },
  advanced: { title: '进阶炸弹', tagline: '红色为危险色 · 更多布局挑战' },
};
