/**
 * Hex grid helpers: pointy-top hexes in "odd-r" offset layout.
 * Each tile is addressed by an index = row * width + col.
 */

export interface GridSize {
  width: number;
  height: number;
}

const EVEN_ROW_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1],
];
const ODD_ROW_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1],
];

export function toIndex(grid: GridSize, col: number, row: number): number {
  return row * grid.width + col;
}

export function colOf(grid: GridSize, index: number): number {
  return index % grid.width;
}

export function rowOf(grid: GridSize, index: number): number {
  return Math.floor(index / grid.width);
}

export function inBounds(grid: GridSize, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.width && row < grid.height;
}

export function neighbors(grid: GridSize, index: number): number[] {
  const col = colOf(grid, index);
  const row = rowOf(grid, index);
  const dirs = row & 1 ? ODD_ROW_DIRS : EVEN_ROW_DIRS;
  const out: number[] = [];
  for (const [dc, dr] of dirs) {
    const c = col + dc;
    const r = row + dr;
    if (inBounds(grid, c, r)) out.push(toIndex(grid, c, r));
  }
  return out;
}

function toAxial(grid: GridSize, index: number): [number, number] {
  const col = colOf(grid, index);
  const row = rowOf(grid, index);
  return [col - (row - (row & 1)) / 2, row];
}

export function hexDistance(grid: GridSize, a: number, b: number): number {
  const [aq, ar] = toAxial(grid, a);
  const [bq, br] = toAxial(grid, b);
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All tiles within `radius` of `center` (inclusive), in index order. */
export function tilesInRadius(grid: GridSize, center: number, radius: number): number[] {
  const out: number[] = [];
  const col = colOf(grid, center);
  const row = rowOf(grid, center);
  for (let r = row - radius; r <= row + radius; r++) {
    for (let c = col - radius - 1; c <= col + radius + 1; c++) {
      if (!inBounds(grid, c, r)) continue;
      const idx = toIndex(grid, c, r);
      if (hexDistance(grid, center, idx) <= radius) out.push(idx);
    }
  }
  return out;
}

/** Neighbour in direction 0..5 (E, NE, NW, W, SW, SE), or -1 if off-map. */
export function neighborInDir(grid: GridSize, index: number, dir: number): number {
  const col = colOf(grid, index);
  const row = rowOf(grid, index);
  const [dc, dr] = (row & 1 ? ODD_ROW_DIRS : EVEN_ROW_DIRS)[dir];
  const c = col + dc;
  const r = row + dr;
  return inBounds(grid, c, r) ? toIndex(grid, c, r) : -1;
}

/** Sort comparator: tiles nearest to `target` first (ties: lower index). */
export function byDistanceTo(grid: GridSize, target: number) {
  return (a: number, b: number) => hexDistance(grid, a, target) - hexDistance(grid, b, target) || a - b;
}

/** Sort comparator: things (units, buildings) nearest to `target` first (ties: lower id). */
export function byDistanceOf(grid: GridSize, target: number) {
  return (a: { tile: number; id: number }, b: { tile: number; id: number }) =>
    hexDistance(grid, a.tile, target) - hexDistance(grid, b.tile, target) || a.id - b.id;
}
