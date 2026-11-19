import { BALANCE } from '../data';
import { tilesInRadius } from '../hex';
import { Knowledge, type GameState } from '../types';
import { buildingVisionRadius } from './territory';



/**
 * Recompute what each player currently sees. Territory is always in vision,
 * and land that becomes territory is explored automatically (no need to
 * send villagers tile by tile).
 */
export function updateVision(state: GameState): void {
  for (const player of state.players) {
    const next = new Array<number>(state.tiles.length).fill(0);
    let learned = false;
    for (let i = 0; i < state.tiles.length; i++) {
      if (state.tiles[i].owner !== player.id) continue;
      next[i] = 1;
      if (player.knowledge[i] !== Knowledge.Explored) {
        player.knowledge[i] = Knowledge.Explored;
        learned = true;
      }
    }
    if (learned) state.mapVersion++;
    for (const v of state.villagers) {
      if (v.owner !== player.id) continue;
      for (const idx of tilesInRadius(state, v.tile, BALANCE.villagerVisionRadius)) next[idx] = 1;
    }
    for (const b of state.buildings) {
      if (b.owner !== player.id) continue;
      for (const idx of tilesInRadius(state, b.tile, buildingVisionRadius(state, b))) next[idx] = 1;
    }
    let changed = next.length !== player.visible.length;
    for (let i = 0; !changed && i < next.length; i++) changed = next[i] !== player.visible[i];
    if (changed) {
      player.visible = next;
      state.mapVersion++;
    }
  }
}
