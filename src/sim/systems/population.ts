import { BALANCE, BUILDINGS } from '../data';
import { incomePerMinute } from '../economy';
import { logEvent, newVillager, secondsToTicks } from '../state';
import { capitalOf, storageCapacity, storesOf, withdraw } from '../storage';
import { getModifiers } from '../modifiers';
import type { GameState, Player } from '../types';
import { foodConsumptionPerMinute } from './food';
import { isComplete } from './territory';

export function populationCap(state: GameState, player: Player): number {
  let cap = 0;
  for (const b of state.buildings) {
    if (b.owner === player.id && isComplete(b)) cap += BUILDINGS[b.type].popCap;
  }
  return cap;
}

export function populationCount(state: GameState, player: Player): number {
  return state.villagers.filter((v) => v.owner === player.id).length;
}

/** Why population growth is currently blocked (zh-Hant), or null if growing. */
export function populationBlocked(state: GameState, player: Player): string | null {
  const m = player.management;
  if (!m.popEnabled) return '已暫停人口生產';
  if (populationCount(state, player) >= populationCap(state, player)) return '已達人口上限，需要更多民宅';
  if (player.stock.food < BALANCE.population.foodCostPerVillager) return '糧食不足';
  if (m.foodProtection && !granaryFull(state, player)) {
    const newcomer = BALANCE.villagerLevels['1'].foodPerMinute;
    const income = incomePerMinute(state, player).food;
    if (income < foodConsumptionPerMinute(state, player) + newcomer) return '糧食收入不足以養活更多人口';
  }
  return null;
}

/** Food stores are (nearly) full: income looks like 0 only because there is no room left. */
export function granaryFull(state: GameState, player: Player): boolean {
  const cap = storesOf(state, player.id).reduce((sum, b) => sum + storageCapacity(b), 0);
  return cap > 0 && player.stock.food >= cap * 0.9;
}

/** Where new villagers appear: the chosen capital/branch city, else the capital. */
export function spawnTile(state: GameState, player: Player): number {
  const chosen = state.buildings.find(
    (b) => b.id === player.management.spawnAt && b.owner === player.id && b.progress >= 1 && (b.type === 'camp' || b.type === 'city'),
  );
  return (chosen ?? capitalOf(state, player.id))?.tile ?? player.startTile;
}

export function popIntervalTicks(player: Player): number {
  return Math.max(1, secondsToTicks(player.management.popIntervalSeconds * getModifiers(player).popInterval));
}

export function runPopulation(state: GameState): void {
  for (const player of state.players) {
    if (player.startTile === -1) continue;
    if (populationBlocked(state, player)) continue;
    player.popProgress++;
    if (player.popProgress < popIntervalTicks(player)) continue;
    player.popProgress = 0;
    const tile = spawnTile(state, player);
    withdraw(state, player.id, tile, { food: BALANCE.population.foodCostPerVillager });
    const v = newVillager(state, player.id, tile);
    logEvent(state, player.id, `新的村民 #${v.id} 加入了國家`);
  }
}
