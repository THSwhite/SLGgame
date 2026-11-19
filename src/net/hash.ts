import type { GameState } from '../sim/types';

/** FNV-1a over a compact summary of the simulation state. Equal on all clients when in sync. */
export function stateHash(state: GameState): string {
  const parts: Array<string | number> = [state.tick, state.rngState, state.phase, state.nextEntityId];
  for (const p of state.players) {
    parts.push(p.id, p.startTile, p.eliminated ? 1 : 0, p.researchPoints.toFixed(3));
    for (const v of Object.values(p.stock)) parts.push(v.toFixed(3));
    parts.push(p.knowledge.reduce((a, k) => a + k, 0));
  }
  for (const v of state.villagers) parts.push(v.id, v.owner, v.tile, v.level, v.hp.toFixed(3), v.order.kind, v.path.length, v.naval ? 1 : 0);
  for (const b of state.buildings) parts.push(b.id, b.owner, b.tile, b.progress.toFixed(4), b.hp.toFixed(3));
  for (const r of state.relations) parts.push(r.status, r.contact ? 1 : 0);
  const text = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
