import { BALANCE, BUILDINGS } from '../data';
import { hexDistance, tilesInRadius } from '../hex';
import { nextRandom } from '../rng';
import { makePlayer } from '../state';
import { addRelationsFor, getRelation } from './diplomacy';
import { recomputeTerritory } from './territory';
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
    declareIndependence(state, city);
  }
}

/**
 * A far-away branch city breaks away and becomes a new AI nation: the city
 * becomes its capital and the villagers around it its people.
 */
export function declareIndependence(state: GameState, city: Building): void {
  const parent = getPlayer(state, city.owner);
  const area = new Set(tilesInRadius(state, city.tile, BALANCE.branchCity.defectRadius));
  const people = state.villagers.filter((v) => v.owner === parent.id && area.has(v.tile));

  if (state.players.length >= BALANCE.branchCity.maxNations) {
    // No room for another nation: the city and its people are simply lost.
    state.villagers = state.villagers.filter((v) => !people.includes(v));
    state.buildings = state.buildings.filter((b) => b !== city);
    state.mapVersion++;
    logEvent(state, parent.id, `距離首都太遠的分城宣布獨立，帶走了 ${people.length} 位村民！`);
    return;
  }

  const id = state.players.length;
  const pool = BALANCE.independentNations;
  const base = pool[(id - 1) % pool.length] ?? { name: '自由城邦', color: '#9e9e9e' };
  const round = Math.floor((id - 1) / pool.length);
  const name = round > 0 ? `${base.name}（${round + 1}）` : base.name;
  const nation = makePlayer(id, { name, color: base.color, isAI: true }, state.tiles.length, {
    aggression: nextRandom(state),
    openness: nextRandom(state),
    expansion: nextRandom(state),
  });
  nation.startTile = city.tile;
  nation.stock = { ...BALANCE.branchCity.independenceStartingStock };
  nation.knowledge = [...parent.knowledge];
  nation.researched = [...parent.researched];
  state.players.push(nation);
  addRelationsFor(state, id);
  getRelation(state, parent.id, id).contact = true;

  city.type = 'camp';
  city.owner = id;
  city.devastation = 0;
  for (const v of people) {
    v.owner = id;
    v.soldier = false;
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    v.loyalty = BALANCE.loyalty.max;
    v.resentment = 0;
  }
  recomputeTerritory(state);
  for (const p of state.players) {
    logEvent(state, p.id, p.id === parent.id
      ? `距離首都太遠的分城宣布獨立，成立了「${name}」，帶走了 ${people.length} 位村民！`
      : `${parent.name} 的分城宣布獨立，成立了新國家「${name}」`);
  }
}
