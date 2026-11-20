import { BALANCE, BUILDINGS, RESOURCE_TYPES, type ResourceType } from './data';
import { byDistanceOf, hexDistance } from './hex';
import type { Building, GameState, Player, PlayerId, TileIndex } from './types';

/**
 * Resources live in stores (capital camps, branch cities, warehouses), each
 * with a per-resource capacity. A nation can spend everything it stores, but
 * goods are always taken from / delivered to the nearest store first.
 * `player.stock` is just the cached total; never change it directly.
 */

export type Amounts = Partial<Record<ResourceType, number>>;

export function emptyStore(): Record<ResourceType, number> {
  return { food: 0, wood: 0, stone: 0, ore: 0 };
}

export function storageCapacity(b: Building): number {
  return BUILDINGS[b.type].storage ?? 0;
}

export function isStore(b: Building): boolean {
  return storageCapacity(b) > 0;
}

/** Give a building its (empty) store if its type has storage. */
export function initStore(b: Building): void {
  if (isStore(b) && !b.store) b.store = emptyStore();
}

/** Usable (completed) stores of a nation. */
export function storesOf(state: GameState, owner: PlayerId): Building[] {
  return state.buildings.filter((b) => b.owner === owner && b.progress >= 1 && b.store !== undefined);
}

/** Stores sorted by distance from `tile` (ties: lower id). */
export function storesByDistance(state: GameState, owner: PlayerId, tile: TileIndex): Building[] {
  return storesOf(state, owner).sort(byDistanceOf(state, tile));
}

export function refreshStock(state: GameState, player: Player): void {
  const total = emptyStore();
  for (const b of storesOf(state, player.id)) for (const r of RESOURCE_TYPES) total[r] += b.store![r];
  player.stock = total;
}

export function refreshAllStocks(state: GameState): void {
  for (const p of state.players) refreshStock(state, p);
}

export function storeSpace(b: Building, r: ResourceType): number {
  return Math.max(0, storageCapacity(b) - (b.store?.[r] ?? 0));
}

/** Income multiplier for a job `distance` tiles away from where its goods are stored. */
export function transportFactor(distance: number): number {
  return 1 / (1 + BALANCE.transport.incomeFactorPerTile * distance);
}

/** Nearest store that still has room for `r`, with its distance. */
export function depositTarget(state: GameState, owner: PlayerId, tile: TileIndex, r: ResourceType) {
  for (const b of storesByDistance(state, owner, tile)) {
    if (storeSpace(b, r) > 1e-9) return { store: b, distance: hexDistance(state, b.tile, tile) };
  }
  return null;
}

/** Put goods into the nearest stores with room (overflow goes further away, the rest is lost). Returns what was stored. */
export function deposit(state: GameState, owner: PlayerId, tile: TileIndex, r: ResourceType, amount: number): number {
  let left = amount;
  for (const b of storesByDistance(state, owner, tile)) {
    if (left <= 1e-12) break;
    const put = Math.min(left, storeSpace(b, r));
    if (put <= 0) continue;
    b.store![r] += put;
    left -= put;
  }
  const player = state.players.find((p) => p.id === owner);
  if (player) refreshStock(state, player);
  return amount - left;
}

/**
 * Take a cost from the stores nearest to `tile` first. The caller must have
 * checked affordability. Returns the distance to the farthest store used
 * (how far the goods have to travel).
 */
export function withdraw(state: GameState, owner: PlayerId, tile: TileIndex, cost: Amounts): number {
  let farthest = 0;
  const stores = storesByDistance(state, owner, tile);
  for (const r of RESOURCE_TYPES) {
    let need = cost[r] ?? 0;
    for (const b of stores) {
      if (need <= 1e-12) break;
      const take = Math.min(need, b.store![r]);
      if (take <= 0) continue;
      b.store![r] -= take;
      need -= take;
      farthest = Math.max(farthest, hexDistance(state, b.tile, tile));
    }
  }
  const player = state.players.find((p) => p.id === owner);
  if (player) refreshStock(state, player);
  return farthest;
}

/** Put goods into one specific store, ignoring capacity (starting stock, scripted setups). */
export function fillStore(state: GameState, b: Building, amounts: Amounts): void {
  initStore(b);
  for (const r of RESOURCE_TYPES) b.store![r] += amounts[r] ?? 0;
  const player = state.players.find((p) => p.id === b.owner);
  if (player) refreshStock(state, player);
}

/** The nation's capital store (first camp), if any. */
export function capitalOf(state: GameState, owner: PlayerId): Building | undefined {
  return state.buildings
    .filter((b) => b.owner === owner && b.type === 'camp' && b.progress >= 1)
    .sort((a, b) => a.id - b.id)[0];
}

/** Take up to `amount` of one resource, nearest store first, without refreshing totals (bulk use). */
export function withdrawUpTo(state: GameState, owner: PlayerId, tile: TileIndex, r: ResourceType, amount: number): number {
  let need = amount;
  for (const b of storesByDistance(state, owner, tile)) {
    if (need <= 1e-12) break;
    const take = Math.min(need, b.store![r]);
    b.store![r] -= take;
    need -= take;
  }
  return amount - need;
}
