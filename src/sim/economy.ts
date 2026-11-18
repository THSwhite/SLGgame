import { BALANCE, BUILDINGS, RESOURCE_TYPES, TERRAIN, type ResourceType } from './data';
import { neighbors } from './hex';
import { getPlayer } from './state';
import type { Building, GameState, Player, Villager } from './types';

export type Rates = Record<ResourceType, number>;

export function zeroRates(): Rates {
  return { food: 0, wood: 0, stone: 0, ore: 0 };
}

export function isStarving(player: Player): boolean {
  return player.stock.food <= 0;
}

export function workEfficiency(state: GameState, v: Villager): number {
  const level = BALANCE.villagerLevels[String(v.level)];
  const starving = isStarving(getPlayer(state, v.owner));
  return level.workEfficiency * (starving ? BALANCE.starvingWorkEfficiency : 1);
}

export function hasFreshWaterNearby(state: GameState, tile: number): boolean {
  return neighbors(state, tile).some((n) => TERRAIN[state.tiles[n].terrain].freshWater);
}

/** Resources per second produced by one worker (efficiency 1) at a building. */
export function buildingRatePerWorker(state: GameState, b: Building): Rates {
  const def = BUILDINGS[b.type];
  const tile = state.tiles[b.tile];
  const out = zeroRates();
  let mult = 1;
  if (def.freshWaterBonus && hasFreshWaterNearby(state, b.tile)) mult += def.freshWaterBonus;
  if (def.nonStoneMultiplier !== undefined && tile.terrain !== 'stone') mult *= def.nonStoneMultiplier;
  for (const r of RESOURCE_TYPES) {
    const base = def.production[r] ?? 0;
    if (base <= 0) continue;
    // Ore can only be mined where an ore deposit exists, and it runs out.
    if (r === 'ore' && !tile.deposits.some((d) => d.resource === 'ore' && d.amount > 0)) continue;
    out[r] = base * mult;
  }
  return out;
}

export function workersAt(state: GameState, buildingId: number): Villager[] {
  return state.villagers.filter((v) => v.order.kind === 'work' && v.order.building === buildingId);
}

/** Current production per second of one villager (0 while travelling). */
export function villagerRate(state: GameState, v: Villager): Rates {
  const out = zeroRates();
  if (v.path.length > 0) return out;
  const eff = workEfficiency(state, v);
  if (v.order.kind === 'gather') {
    out[v.order.resource] = BALANCE.gatherPerSecond[v.order.resource] * eff;
  } else if (v.order.kind === 'work') {
    const id = v.order.building;
    const b = state.buildings.find((x) => x.id === id);
    if (b) {
      const r = buildingRatePerWorker(state, b);
      for (const k of RESOURCE_TYPES) out[k] = r[k] * eff;
    }
  }
  return out;
}

/** Current income per minute of a player, from villagers that are working right now. */
export function incomePerMinute(state: GameState, player: Player): Rates {
  const out = zeroRates();
  for (const v of state.villagers) {
    if (v.owner !== player.id) continue;
    const r = villagerRate(state, v);
    for (const k of RESOURCE_TYPES) out[k] += r[k] * 60;
  }
  return out;
}

export function canAfford(player: Player, cost: Partial<Rates>): boolean {
  return RESOURCE_TYPES.every((r) => player.stock[r] >= (cost[r] ?? 0));
}

export function pay(player: Player, cost: Partial<Rates>): void {
  for (const r of RESOURCE_TYPES) player.stock[r] -= cost[r] ?? 0;
}
