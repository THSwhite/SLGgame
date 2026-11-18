import { TERRAIN } from '../data';
import { hexDistance, tilesInRadius } from '../hex';
import { MIN_START_DISTANCE } from '../commands';
import type { GameState, PlayerId, TileIndex } from '../types';

function score(state: GameState, tile: number): number {
  const ring = tilesInRadius(state, tile, 2);
  if (!ring.every((t) => TERRAIN[state.tiles[t].terrain].land)) return -1;
  return ring.filter((t) => TERRAIN[state.tiles[t].terrain].farmable).length;
}

/** Deterministically pick start tiles for every AI that has none: good land, far from everyone. */
export function chooseAIStarts(state: GameState): Array<[PlayerId, TileIndex]> {
  const taken = state.players.filter((p) => p.startTile !== -1).map((p) => p.startTile);
  const out: Array<[PlayerId, TileIndex]> = [];
  const candidates: number[] = [];
  for (let i = 0; i < state.tiles.length; i++) if (score(state, i) >= 4) candidates.push(i);
  if (candidates.length === 0) {
    for (let i = 0; i < state.tiles.length; i++) if (TERRAIN[state.tiles[i].terrain].land) candidates.push(i);
  }
  for (const p of state.players) {
    if (!p.isAI || p.startTile !== -1) continue;
    let best = -1;
    let bestDist = -1;
    for (const c of candidates) {
      const d = taken.length ? Math.min(...taken.map((t) => hexDistance(state, t, c))) : 0;
      if (d < MIN_START_DISTANCE) continue;
      // Prefer the spot furthest from everyone, but don't hug the map edge.
      const capped = Math.min(d, 18);
      if (capped > bestDist) {
        bestDist = capped;
        best = c;
      }
    }
    if (best === -1) {
      // Map too crowded: take any land far enough, else anything.
      best = candidates.find((c) => !taken.includes(c)) ?? candidates[0];
    }
    taken.push(best);
    out.push([p.id, best]);
  }
  return out;
}
