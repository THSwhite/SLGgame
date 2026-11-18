import { BALANCE } from '../data';
import { getModifiers } from '../modifiers';
import type { GameState, Player, Villager } from '../types';

export function villagerFoodPerMinute(v: Villager, player: Player): number {
  const level = BALANCE.villagerLevels[String(v.level)];
  const mods = getModifiers(player);
  let mult = mods.foodConsumption;
  if (v.soldier && player.atWar) {
    // War penalty: soldiers eat more in wartime (policies can reduce it).
    mult *= 1 + (BALANCE.warSoldierFoodMultiplier - 1) * mods.warFoodPenalty;
  }
  return level.foodPerMinute * mult;
}

export function foodConsumptionPerMinute(state: GameState, player: Player): number {
  let total = 0;
  for (const v of state.villagers) {
    if (v.owner === player.id) total += villagerFoodPerMinute(v, player);
  }
  return total;
}

export function runFood(state: GameState): void {
  const perTick = 60 * BALANCE.ticksPerSecond;
  for (const player of state.players) {
    if (player.startTile === -1) continue;
    const need = foodConsumptionPerMinute(state, player) / perTick;
    player.stock.food = Math.max(0, player.stock.food - need);
  }
}
