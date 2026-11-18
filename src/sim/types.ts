import type { ResourceType, TerrainType } from './data';

export type PlayerId = number;
export type TileIndex = number;

export interface Deposit {
  resource: ResourceType;
  amount: number;
}

export interface Tile {
  terrain: TerrainType;
  deposits: Deposit[];
  /** Owner of the territory on this tile, or -1. */
  owner: PlayerId | -1;
}

/** What a player knows about a tile. */
export const enum Knowledge {
  /** Only land/water is known; resources are hidden. */
  Unknown = 0,
  /** Terrain and resources are known (may be out of date). */
  Explored = 1,
}

export type VillagerOrder =
  | { kind: 'idle' }
  | { kind: 'move'; target: TileIndex }
  | { kind: 'explore'; target: TileIndex; progress: number }
  | { kind: 'gather'; target: TileIndex; resource: ResourceType };

export interface Villager {
  id: number;
  owner: PlayerId;
  level: number;
  tile: TileIndex;
  /** Remaining path (next step first), excluding the current tile. */
  path: TileIndex[];
  /** 0..1 progress towards path[0]. */
  moveProgress: number;
  order: VillagerOrder;
}

export type BuildingType = 'camp';

export interface Building {
  id: number;
  type: BuildingType;
  owner: PlayerId;
  tile: TileIndex;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  isAI: boolean;
  startTile: TileIndex | -1;
  stock: Record<ResourceType, number>;
  /** Knowledge per tile (see Knowledge). */
  knowledge: number[];
  /** 1 if currently in vision, else 0. Derived every tick. */
  visible: number[];
  atWar: boolean;
}

export interface GameEvent {
  tick: number;
  player: PlayerId;
  message: string;
}

export type Phase = 'choosingStart' | 'playing';

export interface GameState {
  seed: number;
  rngState: number;
  tick: number;
  phase: Phase;
  width: number;
  height: number;
  tiles: Tile[];
  players: Player[];
  villagers: Villager[];
  buildings: Building[];
  nextEntityId: number;
  events: GameEvent[];
  /** Bumped when map knowledge/territory changes, so renderers can cache. */
  mapVersion: number;
}
