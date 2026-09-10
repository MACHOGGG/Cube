export type BombTier = 'basic' | 'timed' | 'advanced';

/** Shared across every bomb-mode shape so the hazard reads as "the same red" everywhere. */
export const BOMB_RED_HEX = '#C63B3B';
/** Flat score penalty applied once a live red cluster reaches 4+ tiles. */
export const BOMB_HAZARD_PENALTY = 100;
/** The forceEnd() reason string every bomb shape passes on a hazard-cluster game over — gameController matches on this to know to show the 💥 background. */
export const BOMB_HAZARD_REASON = '红色炸弹相连';
