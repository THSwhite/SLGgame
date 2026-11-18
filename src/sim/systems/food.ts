import { BALANCE } from '../data';
import { getModifiers } from '../modifiers';
import { refreshStock, withdrawUpTo } from '../storage';
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

/** Once per second every villager eats from the store nearest to them (then the next nearest...). */
export function runFood(state: GameState): void {
  if (state.tick % BALANCE.ticksPerSecond !== 0) return;
  for (const player of state.players) {
    if (player.startTile === -1) continue;
    for (const v of state.villagers) {
      if (v.owner !== player.id) continue;
      const need = villagerFoodPerMinute(v, player) / 60;
      withdrawUpTo(state, player.id, v.tile, 'food', need);
    }
    refreshStock(state, player);
  }
}
