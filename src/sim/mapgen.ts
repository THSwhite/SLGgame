import { Rng } from './rng';
import { TERRAIN, type TerrainType } from './data';
import type { Tile } from './types';
import { colOf, neighbors, rowOf, type GridSize } from './hex';

/** Smooth value noise on a coarse lattice (no trig, so it is deterministic). */
function makeNoise(rng: Rng, grid: GridSize, cell: number): (x: number, y: number) => number {
  const lw = Math.ceil(grid.width / cell) + 2;
  const lh = Math.ceil(grid.height / cell) + 2;
  const lattice: number[] = [];
  for (let i = 0; i < lw * lh; i++) lattice.push(rng.next());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    const v = (cx: number, cy: number) => lattice[cy * lw + cx];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function fbm(noises: Array<(x: number, y: number) => number>, x: number, y: number): number {
  let total = 0;
  let weight = 0;
  let w = 1;
  for (const n of noises) {
    total += n(x, y) * w;
    weight += w;
    w *= 0.5;
  }
  return total / weight;
}

/** Higher = fewer scattered groves (0..1). */
const GROVE_THRESHOLD = 0.72;

/** Generate a continent-style map. The same seed always gives the same map. */
export function generateMap(seed: number, grid: GridSize): Tile[] {
  const rng = new Rng(seed);
  const elevN = [8, 4, 2].map((c) => makeNoise(rng, grid, c));
  const moistN = [6, 3].map((c) => makeNoise(rng, grid, c));
  // Fine-grained noise for small groves, so most areas have some forest nearby.
  const groveN = makeNoise(rng, grid, 2);

  const terrain: TerrainType[] = [];
  const elevation: number[] = [];
  const moisture: number[] = [];
  const cx = (grid.width - 1) / 2;
  const cy = (grid.height - 1) / 2;

  for (let i = 0; i < grid.width * grid.height; i++) {
    const x = colOf(grid, i) + (rowOf(grid, i) & 1 ? 0.5 : 0);
    const y = rowOf(grid, i);
    // Falloff towards the edges so the map is surrounded by ocean.
    const dx = (x - cx) / cx;
    const dy = (y - cy) / cy;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    const falloff = edge > 0.7 ? (edge - 0.7) / 0.3 : 0;
    const e = fbm(elevN, x, y) - falloff * 0.6;
    const m = fbm(moistN, x, y);
    elevation.push(e);
    moisture.push(m);

    let t: TerrainType;
    if (e < 0.42) t = 'ocean';
    else if (e > 0.66) t = 'stone';
    else if (m > 0.6) t = 'forest';
    else if (m > 0.5 && e < 0.52) t = 'mud';
    else if (m < 0.33 && e < 0.47) t = 'sand';
    else t = 'grass';
    if ((t === 'grass' || t === 'mud') && groveN(x, y) > GROVE_THRESHOLD) t = 'forest';
    terrain.push(t);
  }

  // A few small inland lakes (fresh water for farming bonuses later).
  const lakeCandidates: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === 'grass' || terrain[i] === 'mud') {
      if (neighbors(grid, i).every((n) => TERRAIN[terrain[n]].land)) lakeCandidates.push(i);
    }
  }
  const lakeCount = Math.min(4, Math.floor(lakeCandidates.length / 80));
  for (let k = 0; k < lakeCount; k++) {
    const seedTile = lakeCandidates[rng.int(0, lakeCandidates.length - 1)];
    terrain[seedTile] = 'lake';
    const extra = rng.int(0, 2);
    let current = seedTile;
    for (let j = 0; j < extra; j++) {
      const ns = neighbors(grid, current).filter((n) => TERRAIN[terrain[n]].land);
      if (ns.length === 0) break;
      current = ns[rng.int(0, ns.length - 1)];
      terrain[current] = 'lake';
    }
  }

  return terrain.map((t) => {
    const def = TERRAIN[t];
    const deposits = def.deposits
      .filter((d) => rng.next() < d.chance)
      .map((d) => ({ resource: d.resource, amount: rng.int(d.min, d.max) }));
    return { terrain: t, deposits, owner: -1 as const };
  });
}
