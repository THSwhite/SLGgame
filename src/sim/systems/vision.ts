import { BALANCE } from '../data';
import { tilesInRadius } from '../hex';
import type { Building, GameState } from '../types';

function buildingVision(b: Building): number {
  switch (b.type) {
    case 'camp':
      return BALANCE.camp.visionRadius;
    default:
      return 1;
  }
}

/** Recompute what each player currently sees. Territory is always in vision. */
export function updateVision(state: GameState): void {
  for (const player of state.players) {
    const next = new Array<number>(state.tiles.length).fill(0);
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i].owner === player.id) next[i] = 1;
    }
    for (const v of state.villagers) {
      if (v.owner !== player.id) continue;
      for (const idx of tilesInRadius(state, v.tile, BALANCE.villagerVisionRadius)) next[idx] = 1;
    }
    for (const b of state.buildings) {
      if (b.owner !== player.id) continue;
      for (const idx of tilesInRadius(state, b.tile, buildingVision(b))) next[idx] = 1;
    }
    let changed = next.length !== player.visible.length;
    for (let i = 0; !changed && i < next.length; i++) changed = next[i] !== player.visible[i];
    if (changed) {
      player.visible = next;
      state.mapVersion++;
    }
  }
}
