import { BALANCE, TERRAIN } from '../data';
import { tilesInRadius } from '../hex';
import type { Building, GameState } from '../types';

/** Territory radius granted by a building type (0 = not a territory building). */
export function territoryRadius(b: Building): number {
  switch (b.type) {
    case 'camp':
      return BALANCE.camp.territoryRadius;
    default:
      return 0;
  }
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
