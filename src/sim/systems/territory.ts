import { BUILDINGS, TERRAIN } from '../data';
import { hexDistance, neighbors, tilesInRadius } from '../hex';
import { getModifiers } from '../modifiers';
import { getPlayer } from '../state';
import type { Building, GameState, PlayerId, TileIndex } from '../types';

export function isComplete(b: Building): boolean {
  return b.progress >= 1;
}

/** Soldiers currently stationed inside a building. */
export function garrisonOf(state: GameState, b: Building) {
  return state.villagers.filter(
    (v) => v.order.kind === 'garrison' && v.order.building === b.id && v.path.length === 0 && v.owner === b.owner,
  );
}

/** Whether the building currently provides its effects (complete, and garrisoned if required). */
export function isActive(state: GameState, b: Building): boolean {
  if (!isComplete(b)) return false;
  if (BUILDINGS[b.type].requiresGarrison) return garrisonOf(state, b).length > 0;
  return true;
}

/** Territory radius granted by a building right now (0 = none). */
export function territoryRadius(state: GameState, b: Building): number {
  const def = BUILDINGS[b.type];
  if (def.territoryRadius <= 0 || !isActive(state, b)) return 0;
  const bonus = def.requiresGarrison ? getModifiers(getPlayer(state, b.owner)).towerRadiusBonus : 0;
  return def.territoryRadius + bonus;
}

/** Vision radius of a building right now. Ungarrisoned towers only see their own tile. */
export function buildingVisionRadius(state: GameState, b: Building): number {
  const def = BUILDINGS[b.type];
  if (def.requiresGarrison) {
    if (!isActive(state, b)) return 0;
    return def.visionRadius + getModifiers(getPlayer(state, b.owner)).towerVisionBonus;
  }
  return def.visionRadius;
}

let lastSignature = new WeakMap<GameState, string>();

/** Recompute tile ownership (land only) from all territory buildings. First come, first served. */
export function recomputeTerritory(state: GameState): void {
  for (const t of state.tiles) t.owner = -1;
  const ordered = [...state.buildings].sort((a, b) => a.id - b.id);
  const sig: string[] = [];
  for (const b of ordered) {
    const radius = territoryRadius(state, b);
    if (radius <= 0) continue;
    sig.push(`${b.id}:${radius}`);
    for (const idx of tilesInRadius(state, b.tile, radius)) {
      const tile = state.tiles[idx];
      if (TERRAIN[tile.terrain].land && tile.owner === -1) tile.owner = b.owner;
    }
  }
  lastSignature.set(state, sig.join(','));
  state.mapVersion++;
}

/** Cheap per-tick check: recompute only when some building's territory changed. */
export function updateTerritory(state: GameState): void {
  const sig: string[] = [];
  for (const b of [...state.buildings].sort((a, c) => a.id - c.id)) {
    const r = territoryRadius(state, b);
    if (r > 0) sig.push(`${b.id}:${r}`);
  }
  if (lastSignature.get(state) !== sig.join(',')) recomputeTerritory(state);
}

/** For tests: forget cached signatures. */
export function resetTerritoryCache(): void {
  lastSignature = new WeakMap();
}

/** Distance from a tile to the nearest tile of the player's territory (Infinity if none). */
export function distanceToTerritory(state: GameState, player: PlayerId, tile: TileIndex): number {
  let best = Infinity;
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i].owner !== player) continue;
    const d = hexDistance(state, i, tile);
    if (d < best) best = d;
    if (best === 0) break;
  }
  return best;
}

/**
 * Would a territory building of `radius` at `tile` keep the player's territory
 * connected? True when its area overlaps or touches existing territory.
 */
export function connectsToTerritory(state: GameState, player: PlayerId, tile: TileIndex, radius: number): boolean {
  for (const idx of tilesInRadius(state, tile, radius)) {
    if (state.tiles[idx].owner === player) return true;
    if (neighbors(state, idx).some((n) => state.tiles[n].owner === player)) return true;
  }
  return false;
}
