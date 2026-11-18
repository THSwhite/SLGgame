import { BALANCE, BUILDINGS } from '../data';
import { hexDistance, tilesInRadius } from '../hex';
import { nextRandom } from '../rng';
import { getPlayer, logEvent } from '../state';
import type { Building, GameState, Player } from '../types';
import { isComplete } from './territory';

/** Branch cities (incl. construction sites) a player owns. */
export function cityCount(state: GameState, player: Player): number {
  return state.buildings.filter((b) => b.owner === player.id && b.type === 'city').length;
}

export function cityLimit(state: GameState, player: Player): number {
  const owned = state.tiles.filter((t) => t.owner === player.id).length;
  return Math.floor(owned / BALANCE.branchCity.territoryTilesPerCity);
}

/** Own villagers standing (not walking) on the tile or one of its 6 neighbours. */
export function villagersNearby(state: GameState, b: Building): number {
  const area = new Set(tilesInRadius(state, b.tile, 1));
  return state.villagers.filter((v) => v.owner === b.owner && v.path.length === 0 && area.has(v.tile)).length;
}

/** Whether construction of this building is currently stalled for lack of people. */
export function lacksWorkforce(state: GameState, b: Building): boolean {
  const need = BUILDINGS[b.type].minVillagersNearby ?? 0;
  return need > 0 && villagersNearby(state, b) < need;
}

/** Distance from a city to its owner's nearest capital (camp); Infinity if none. */
export function distanceToCapital(state: GameState, b: Building): number {
  const capitals = state.buildings.filter((x) => x.owner === b.owner && x.type === 'camp' && isComplete(x));
  return capitals.length ? Math.min(...capitals.map((c) => hexDistance(state, c.tile, b.tile))) : Infinity;
}

export function independenceThreshold(state: GameState): number {
  return Math.round(state.width * BALANCE.branchCity.independenceDistanceShare);
}

/** Chance per minute that this city declares independence (0 when close enough). */
export function independenceChance(state: GameState, b: Building): number {
  const d = distanceToCapital(state, b);
  const t = independenceThreshold(state);
  if (d <= t) return 0;
  if (!Number.isFinite(d)) return BALANCE.branchCity.independenceBaseChancePerMinute;
  const cfg = BALANCE.branchCity;
  return Math.min(1, cfg.independenceBaseChancePerMinute + (cfg.independenceExtraChancePerMinute * (d - t)) / t);
}

/** Once per minute: far-away branch cities may break away with the villagers around them. */
export function runCities(state: GameState): void {
  if (state.tick % (60 * BALANCE.ticksPerSecond) !== 0) return;
  const cities = state.buildings.filter((b) => b.type === 'city' && isComplete(b)).sort((a, b) => a.id - b.id);
  for (const city of cities) {
    const chance = independenceChance(state, city);
    if (chance <= 0 || nextRandom(state) >= chance) continue;
    const owner = getPlayer(state, city.owner);
    const area = new Set(tilesInRadius(state, city.tile, BALANCE.branchCity.defectRadius));
    const leaving = state.villagers.filter((v) => v.owner === city.owner && area.has(v.tile));
    state.villagers = state.villagers.filter((v) => !leaving.includes(v));
    state.buildings = state.buildings.filter((b) => b !== city);
    state.mapVersion++;
    logEvent(state, owner.id, `距離首都太遠的分城宣布獨立，帶走了 ${leaving.length} 位村民！`);
  }
}
