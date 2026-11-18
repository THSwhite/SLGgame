import { findPolicy, TECHS, type Effects } from './data';
import type { Player } from './types';

/**
 * Every number a tech or policy can change. Multipliers start at 1 and
 * effects add to them (0.25 = +25%); bonuses start at 0.
 */
export const DEFAULT_MODIFIERS = {
  farmRate: 1,
  mineRate: 1,
  gatherFood: 1,
  gatherWood: 1,
  gatherStone: 1,
  gatherOre: 1,
  buildSpeed: 1,
  trainSpeed: 1,
  researchRate: 1,
  towerRadiusBonus: 0,
  towerVisionBonus: 0,
  loyaltyDecay: 1,
  popInterval: 1,
  foodConsumption: 1,
  /** Scales the extra food soldiers eat in wartime (1 = full penalty). */
  warFoodPenalty: 1,
  soldierSpeed: 1,
  soldierAttack: 1,
  soldierDefense: 1,
  roughTerrainDefense: 0,
  soldierLoyaltyImmune: 0,
  subversionResist: 0,
  consulateDeadline: 1,
  tradeIncome: 1,
};

export type Modifiers = typeof DEFAULT_MODIFIERS;
export type ModifierKey = keyof Modifiers;

function apply(mods: Modifiers, effects: Effects) {
  for (const [k, v] of Object.entries(effects)) {
    if (k in mods) mods[k as ModifierKey] += v;
  }
}

const cache = new WeakMap<Player, { key: string; mods: Modifiers }>();

/** The player's current modifiers from researched techs and adopted policies. */
export function getModifiers(player: Player): Modifiers {
  const key = player.researched.join(',') + '|' + player.policies.join(',');
  const hit = cache.get(player);
  if (hit && hit.key === key) return hit.mods;
  const mods: Modifiers = { ...DEFAULT_MODIFIERS };
  for (const id of player.researched) if (TECHS[id]) apply(mods, TECHS[id].effects);
  for (const id of player.policies) {
    const p = findPolicy(id);
    if (p) apply(mods, p.def.effects);
  }
  // Never let a multiplier go negative.
  for (const k of Object.keys(mods) as ModifierKey[]) mods[k] = Math.max(0, mods[k]);
  cache.set(player, { key, mods });
  return mods;
}
