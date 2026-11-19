import terrainJson from './terrain.json';
import balanceJson from './balance.json';
import buildingsJson from './buildings.json';
import techJson from './tech.json';
import techBranchesJson from './techBranches.json';
import policiesJson from './policies.json';

export type ResourceType = 'food' | 'wood' | 'stone' | 'ore';
export const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'wood', 'stone', 'ore'];
export const RESOURCE_NAMES: Record<ResourceType, string> = {
  food: '糧食',
  wood: '木材',
  stone: '石材',
  ore: '礦石',
};

export interface DepositDef {
  resource: ResourceType;
  chance: number;
  min: number;
  max: number;
}

export interface TerrainDef {
  name: string;
  land: boolean;
  freshWater: boolean;
  moveCost: number;
  farmable: boolean;
  color: string;
  deposits: DepositDef[];
}

export type TerrainType = keyof typeof terrainJson;
export const TERRAIN = terrainJson as Record<TerrainType, TerrainDef>;

export interface VillagerLevelDef {
  foodPerMinute: number;
  canEnlist: boolean;
  workEfficiency: number;
}

export interface Balance {
  ticksPerSecond: number;
  map: { width: number; height: number };
  exploreSeconds: number;
  moveSecondsPerTile: number;
  gatherPerSecond: Record<ResourceType, number>;
  startingVillagers: number;
  startingStock: Record<ResourceType, number>;
  villagerLevels: Record<string, VillagerLevelDef>;
  warSoldierFoodMultiplier: number;
  starvingWorkEfficiency: number;
  camp: { exploredRadius: number };
  villagerVisionRadius: number;
  population: {
    foodCostPerVillager: number;
    defaultIntervalSeconds: number;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
  };
  /** How far outside own territory a non-territory building may be placed. */
  nonTerritoryBuildingMaxDistance: number;
  training: { seconds: number; foodCost: number; maxLevel: number };
  diplomacy: {
    proposalSeconds: number;
    consulateDeadlineSeconds: number;
    cooldownSeconds: number;
    /** After a rejected proposal, wait this long before proposing again. */
    rejectCooldownSeconds: number;
    tradePerMinute: Record<ResourceType, number>;
    exchangeResearchBonus: number;
  };
  ai: { thinkEverySeconds: number };
  combat: {
    soldierAttack: number;
    civilianAttack: number;
    hp: Record<string, number>;
    regenPerSecond: number;
    roughTerrainDefense: number;
    garrisonDefense: number;
    plunderShare: number;
    /** Damage multiplier when a soldier supports a battle on an adjacent tile. */
    supportDamageMultiplier: number;
    /** HP share a captured building keeps. */
    captureHpShare: number;
  };
  victory: {
    /** From `minute` on, holding `share` of all land wins (latest matching entry applies). */
    territorySchedule: Array<{ minute: number; share: number }>;
    /** At this minute the nation with the most land wins. */
    timeLimitMinutes: number;
  };
  mapSizes: Record<string, { width: number; height: number; name: string }>;
  branchCity: {
    /** One branch city allowed per this many territory tiles. */
    territoryTilesPerCity: number;
    /** Independence risk beyond this share of the map width from the nearest capital. */
    independenceDistanceShare: number;
    independenceBaseChancePerMinute: number;
    /** Added per full threshold-distance beyond the threshold. */
    independenceExtraChancePerMinute: number;
    /** Villagers within this radius leave together with the city. */
    defectRadius: number;
    /** Stock a newly independent nation starts with. */
    independenceStartingStock: Record<ResourceType, number>;
    /** No new nations once this many exist (the city is simply lost instead). */
    maxNations: number;
  };
  naval: {
    /** Movement cost of a water tile (land costs come from terrain.json). */
    seaMoveCost: number;
    /** Tech that lets units put to sea from own harbors. */
    sailTech: string;
    /** Tech that unlocks training navy at harbors. */
    navyTech: string;
    navy: { trainSeconds: number; cost: Partial<Record<ResourceType, number>>; attack: number; hp: number };
  };
  /** Names/colors for nations founded by independent cities. */
  independentNations: Array<{ name: string; color: string }>;
  conquest: {
    /** A city's region = its territory radius + this. */
    regionExtraRadius: number;
    devastationPerKill: number;
    devastationPerBuildingHp: number;
    devastationPerDestroyedBuilding: number;
    maxResentment: number;
    resentmentDecayPerSecond: number;
  };
  transport: {
    /** Income from a job k tiles from the nearest store is multiplied by 1 / (1 + factor × k). */
    incomeFactorPerTile: number;
    /** Construction waits this long per tile between the site and the farthest store paying for it. */
    deliverySecondsPerTile: number;
    /** How much of one resource a transporting villager carries per trip. */
    carryCapacity: number;
  };
  loyalty: {
    max: number;
    start: number;
    decayPerSecond: number;
    recoverPerSecond: number;
    threshold: number;
    defectChancePerSecond: number;
    subvertRange: number;
    afterDefection: number;
    /** Work efficiency at loyalty 0 (scales linearly up to 1 at full loyalty). */
    minWorkEfficiency: number;
  };
}

export const BALANCE = balanceJson as Balance;

export type BuildingType = keyof typeof buildingsJson;

export interface BuildingDef {
  name: string;
  buildable: boolean;
  cost: Partial<Record<ResourceType, number>>;
  buildSeconds: number;
  /** Terrain requirement: any land, or farmable land only. */
  /** 'coastal' = land next to water (ports). */
  placement: 'land' | 'farmable' | 'coastal';
  /**
   * Territory rule: 'connected' = territory building whose area must connect
   * to existing territory; 'near' = may stand up to N tiles outside territory;
   * 'foreign' = must stand in the territory of a nation we have relations with;
   * 'free' = anywhere not owned by another nation, no connection needed (branch city).
   */
  territory: 'none' | 'connected' | 'near' | 'foreign' | 'free';
  territoryRadius: number;
  visionRadius: number;
  popCap: number;
  workerSlots: number;
  /** Resources per second per worker. */
  production: Partial<Record<ResourceType, number>>;
  freshWaterBonus?: number;
  nonStoneMultiplier?: number;
  /** Production multiplier when not standing on forest (lumber camp). */
  nonForestMultiplier?: number;
  /** Extra production per adjacent forest tile (0.1 = +10% each). */
  forestAdjacencyBonus?: number;
  /** Terrains this building may not be placed on. */
  forbiddenTerrain?: string[];
  /** Modifier key (see modifiers.ts) that scales this building's production. */
  rateModifier?: string;
  /** Overrides nonTerritoryBuildingMaxDistance for 'near' buildings. */
  maxOutsideDistance?: number;
  trainingSlots: number;
  garrisonSlots: number;
  /** Territory and vision only work while soldiers are garrisoned. */
  requiresGarrison?: boolean;
  /** Research points per second per worker. */
  researchPerWorker?: number;
  hp: number;
  /** Captured (instead of destroyed) when its HP reaches 0 in war. */
  capturable?: boolean;
  /** Construction only progresses with at least this many own villagers on the tile or its 6 neighbours. */
  minVillagersNearby?: number;
  /** Storage capacity per resource (capitals, branch cities, warehouses). */
  storage?: number;
  /** Tech that must be researched before this can be built. */
  requiresTech?: string;
  /** Ships leave from / dock at this building (ports). */
  harbor?: boolean;
  /** How many soldiers can train as navy here at once. */
  navalTrainingSlots?: number;
}

export const BUILDINGS = buildingsJson as Record<BuildingType, BuildingDef>;
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

/** Additive effect values; see DEFAULT_MODIFIERS in modifiers.ts. */
export type Effects = Record<string, number>;

export interface TechDef {
  name: string;
  /** Column in the tech tree (see techBranches.json). */
  branch: string;
  /** Row (1 = first). Each tech requires the previous one in its branch. */
  tier: number;
  cost: number;
  requires: string[];
  description: string;
  effects: Effects;
}
export const TECHS = techJson as Record<string, TechDef>;
export const TECH_BRANCHES = techBranchesJson as Array<{ id: string; name: string }>;

export interface PolicyDef {
  name: string;
  cost: number;
  description: string;
  effects: Effects;
}
export interface PolicyGroupDef {
  name: string;
  options: Record<string, PolicyDef>;
}
export const POLICY_GROUPS = policiesJson as Record<string, PolicyGroupDef>;

export function findPolicy(id: string): { group: string; def: PolicyDef } | null {
  for (const [group, g] of Object.entries(POLICY_GROUPS)) {
    if (g.options[id]) return { group, def: g.options[id] };
  }
  return null;
}
