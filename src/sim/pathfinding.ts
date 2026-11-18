import { TERRAIN } from './data';
import { hexDistance, neighbors } from './hex';
import type { GameState, TileIndex } from './types';

/** Minimal binary min-heap keyed by priority. */
class MinHeap {
  private items: Array<[number, number]> = [];
  get size() {
    return this.items.length;
  }
  push(value: number, priority: number) {
    const a = this.items;
    a.push([priority, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0][1];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function moveCost(state: GameState, tile: TileIndex): number {
  return TERRAIN[state.tiles[tile].terrain].moveCost;
}

/**
 * A* over land tiles. Returns the path excluding `from` (empty if already
 * there), or null if unreachable. Ties are broken deterministically.
 */
export function findPath(state: GameState, from: TileIndex, to: TileIndex): TileIndex[] | null {
  if (from === to) return [];
  if (!TERRAIN[state.tiles[to].terrain].land) return null;
  const cost = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const open = new MinHeap();
  open.push(from, 0);
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === to) break;
    const base = cost.get(cur)!;
    for (const n of neighbors(state, cur)) {
      const c = moveCost(state, n);
      if (c <= 0) continue;
      const nc = base + c;
      const prev = cost.get(n);
      if (prev === undefined || nc < prev) {
        cost.set(n, nc);
        came.set(n, cur);
        open.push(n, nc + hexDistance(state, n, to));
      }
    }
  }
  if (!came.has(to)) return null;
  const path: number[] = [];
  let cur = to;
  while (cur !== from) {
    path.push(cur);
    cur = came.get(cur)!;
  }
  return path.reverse();
}
