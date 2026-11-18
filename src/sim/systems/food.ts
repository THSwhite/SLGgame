import { BALANCE } from '../data';
import type { GameState, Player, Villager } from '../types';

export function villagerFoodPerMinute(v: Villager, atWar: boolean): number {
  const level = BALANCE.villagerLevels[String(v.level)];
  const isSoldier = false; // Soldiers arrive with the barracks (M3).
  return level.foodPerMinute * (isSoldier && atWar ? BALANCE.warSoldierFoodMultiplier : 1);
}

export function foodConsumptionPerMinute(state: GameState, player: Player): number {
  let total = 0;
  for (const v of state.villagers) {
    if (v.owner === player.id) total += villagerFoodPerMinute(v, player.atWar);
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
