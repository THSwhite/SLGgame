import { BUILDINGS, TERRAIN } from '../data';
import { hexDistance, neighbors, tilesInRadius } from '../hex';
import type { Building, GameState, PlayerId, TileIndex } from '../types';

export function isComplete(b: Building): boolean {
  return b.progress >= 1;
}

/** Territory radius granted by a building (0 = not a territory building). */
export function territoryRadius(b: Building): number {
  return isComplete(b) ? BUILDINGS[b.type].territoryRadius : 0;
}

/** Recompute tile ownership (land only) from all territory buildings. First come, first served. */
export function recomputeTerritory(state: GameState): void {
  for (const t of state.tiles) t.owner = -1;
  const ordered = [...state.buildings].sort((a, b) => a.id - b.id);
  for (const b of ordered) {
    const radius = territoryRadius(b);
    if (radius <= 0) continue;
    for (const idx of tilesInRadius(state, b.tile, radius)) {
      const tile = state.tiles[idx];
      if (TERRAIN[tile.terrain].land && tile.owner === -1) tile.owner = b.owner;
    }
  }
  state.mapVersion++;
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
