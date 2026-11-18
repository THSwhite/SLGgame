import type { BuildingType, ResourceType, TerrainType } from './data';

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
  | { kind: 'gather'; target: TileIndex; resource: ResourceType }
  | { kind: 'construct'; building: number }
  | { kind: 'work'; building: number }
  /** Training at a barracks. Food is paid on arrival; cannot be interrupted once started. */
  | { kind: 'train'; building: number; progress: number; paid: boolean }
  | { kind: 'garrison'; building: number }
  /** Soldiers march to a tile and fight whatever enemy is there. */
  | { kind: 'attack'; target: TileIndex };

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
  /** Only LV2+ may be soldiers. Soldiers cannot do productive work. */
  soldier: boolean;
  /** 0..100. Falls while outside territory and tower coverage. */
  loyalty: number;
  hp: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  owner: PlayerId;
  tile: TileIndex;
  /** Construction progress 0..1; 1 means complete. */
  progress: number;
  /** For consulates: the nation hosting it. */
  host?: PlayerId;
  hp: number;
}

/** Per-player settings from the management menu. */
export interface Management {
  /** Seconds per new villager. */
  popIntervalSeconds: number;
  popEnabled: boolean;
  /** Only grow if food income still covers consumption afterwards. */
  foodProtection: boolean;
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
  management: Management;
  /** Ticks accumulated towards the next villager. */
  popProgress: number;
  /** Completed techs (ids from tech.json). */
  researched: string[];
  /** Adopted policies (option ids from policies.json). */
  policies: string[];
  /** Tech or policy id currently being researched. */
  currentResearch: string | null;
  /** Research points accumulated (spent when a research completes). */
  researchPoints: number;
  /** Personality for AI players (0..1 each). */
  ai: AIPersonality | null;
  eliminated: boolean;
}

export interface AIPersonality {
  aggression: number;
  openness: number;
  expansion: number;
}

/**
 * Diplomatic relation between two nations.
 * none -> (proposal accepted) -> establishing -> (both consulates built) -> allied
 * establishing past its deadline -> none + cooldown. Any -> war (declaration).
 */
export type RelationStatus = 'none' | 'establishing' | 'allied' | 'war';

export interface Proposal {
  from: PlayerId;
  kind: 'relations' | 'peace';
  expires: number;
}

export interface Relation {
  /** Lower player id. */
  a: PlayerId;
  /** Higher player id. */
  b: PlayerId;
  contact: boolean;
  status: RelationStatus;
  proposal: Proposal | null;
  /** Tick by which both consulates must exist (status 'establishing'). */
  deadline: number;
  /** No new relations may be proposed before this tick. */
  cooldownUntil: number;
  /** Tick of the last status change. */
  since: number;
}

export interface GameEvent {
  tick: number;
  player: PlayerId;
  message: string;
}

export type Phase = 'choosingStart' | 'playing' | 'ended';

export interface GameResult {
  winner: PlayerId | null;
  reason: 'conquest' | 'territory' | 'time' | 'defeat';
  tick: number;
}

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
  relations: Relation[];
  /** Tiles where fighting happened this tick (for rendering). */
  combatTiles: TileIndex[];
  result: GameResult | null;
}
