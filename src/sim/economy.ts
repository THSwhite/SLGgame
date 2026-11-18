import { BALANCE, BUILDINGS, RESOURCE_TYPES, TERRAIN, type ResourceType } from './data';
import { neighbors } from './hex';
import { getModifiers, type Modifiers } from './modifiers';
import { getPlayer } from './state';
import type { Building, GameState, Player, Villager } from './types';
import { alliedCount, tradePerMinute } from './systems/diplomacy';

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

const GATHER_MOD: Record<ResourceType, keyof Modifiers> = {
  food: 'gatherFood',
  wood: 'gatherWood',
  stone: 'gatherStone',
  ore: 'gatherOre',
};

/** Hand-gathering speed per second for a player (efficiency 1). */
export function gatherRate(player: Player, r: ResourceType): number {
  return BALANCE.gatherPerSecond[r] * getModifiers(player)[GATHER_MOD[r]];
}

/** Resources per second produced by one worker (efficiency 1) at a building. */
export function buildingRatePerWorker(state: GameState, b: Building): Rates {
  const def = BUILDINGS[b.type];
  const tile = state.tiles[b.tile];
  const mods = getModifiers(getPlayer(state, b.owner));
  const out = zeroRates();
  let mult = 1;
  if (def.freshWaterBonus && hasFreshWaterNearby(state, b.tile)) mult += def.freshWaterBonus;
  if (def.nonStoneMultiplier !== undefined && tile.terrain !== 'stone') mult *= def.nonStoneMultiplier;
  if (b.type === 'farm') mult *= mods.farmRate;
  if (b.type === 'mine') mult *= mods.mineRate;
  for (const r of RESOURCE_TYPES) {
    const base = def.production[r] ?? 0;
    if (base <= 0) continue;
    // Ore can only be mined where an ore deposit exists, and it runs out.
    if (r === 'ore' && !tile.deposits.some((d) => d.resource === 'ore' && d.amount > 0)) continue;
    out[r] = base * mult;
  }
  return out;
}

/** Research points per second produced by one worker (efficiency 1) at a building. */
export function researchRatePerWorker(state: GameState, b: Building): number {
  const base = BUILDINGS[b.type].researchPerWorker ?? 0;
  // Exchange with allied nations speeds up research.
  const exchange = 1 + BALANCE.diplomacy.exchangeResearchBonus * alliedCount(state, b.owner);
  return base * getModifiers(getPlayer(state, b.owner)).researchRate * exchange;
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
    out[v.order.resource] = gatherRate(getPlayer(state, v.owner), v.order.resource) * eff;
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

/** Current income per minute of a player: working villagers plus trade. */
export function incomePerMinute(state: GameState, player: Player): Rates {
  const out = tradePerMinute(state, player.id);
  for (const v of state.villagers) {
    if (v.owner !== player.id) continue;
    const r = villagerRate(state, v);
    for (const k of RESOURCE_TYPES) out[k] += r[k] * 60;
  }
  return out;
}

/** Research points per minute currently being produced. */
export function researchPerMinute(state: GameState, player: Player): number {
  let total = 0;
  for (const v of state.villagers) {
    if (v.owner !== player.id || v.order.kind !== 'work' || v.path.length > 0) continue;
    const id = v.order.building;
    const b = state.buildings.find((x) => x.id === id);
    if (b) total += researchRatePerWorker(state, b) * workEfficiency(state, v) * 60;
  }
  return total;
}

export function canAfford(player: Player, cost: Partial<Rates>): boolean {
  return RESOURCE_TYPES.every((r) => player.stock[r] >= (cost[r] ?? 0));
}

export function pay(player: Player, cost: Partial<Rates>): void {
  for (const r of RESOURCE_TYPES) player.stock[r] -= cost[r] ?? 0;
}
