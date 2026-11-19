import { BALANCE, BUILDINGS, TERRAIN } from './data';
import { hexDistance, neighbors } from './hex';
import type { GameState, PlayerId, TileIndex } from './types';

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

export function isWater(state: GameState, tile: TileIndex): boolean {
  return !TERRAIN[state.tiles[tile].terrain].land;
}

export function moveCost(state: GameState, tile: TileIndex): number {
  return isWater(state, tile) ? BALANCE.naval.seaMoveCost : TERRAIN[state.tiles[tile].terrain].moveCost;
}

/** Tiles of the owner's completed harbors (ports). */
export function harborTiles(state: GameState, owner: PlayerId): Set<TileIndex> {
  return new Set(state.buildings.filter((b) => b.owner === owner && b.progress >= 1 && BUILDINGS[b.type].harbor).map((b) => b.tile));
}

/** Can this nation put to sea (shipping researched and at least one harbor)? */
export function canSail(state: GameState, owner: PlayerId): boolean {
  const p = state.players.find((x) => x.id === owner);
  return !!p && p.researched.includes(BALANCE.naval.sailTech) && harborTiles(state, owner).size > 0;
}

export interface PathOptions {
  /** Whose ships/harbors may be used. Without it, units walk on land only. */
  owner?: PlayerId;
  /** Navy: water and own harbors only. */
  naval?: boolean;
}

/** Path options for a unit. */
export function pathOpts(v: { owner: PlayerId; naval: boolean }): PathOptions {
  return { owner: v.owner, naval: v.naval };
}

/**
 * A* path. Land units walk on land; with shipping they may also put to sea
 * from an own harbor and land on any coast. Navy moves on water and own
 * harbors only. Returns the path excluding `from` (empty if already there),
 * or null if unreachable. Ties are broken deterministically.
 */
export function findPath(state: GameState, from: TileIndex, to: TileIndex, opts: PathOptions = {}): TileIndex[] | null {
  if (from === to) return [];
  const harbors = opts.owner !== undefined && (opts.naval || canSail(state, opts.owner)) ? harborTiles(state, opts.owner) : new Set<number>();
  const sailing = !opts.naval && harbors.size > 0;
  if (opts.naval ? !isWater(state, to) && !harbors.has(to) : isWater(state, to)) return null;
  const passable = (cur: number, n: number): boolean => {
    if (opts.naval) return isWater(state, n) || harbors.has(n);
    if (!isWater(state, n)) return true;
    // Boarding only at own harbors; once at sea, keep sailing or land anywhere.
    return sailing && (isWater(state, cur) || harbors.has(cur));
  };
  const cost = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const open = new MinHeap();
  open.push(from, 0);
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === to) break;
    const base = cost.get(cur)!;
    for (const n of neighbors(state, cur)) {
      if (!passable(cur, n)) continue;
      const c = moveCost(state, n);
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
