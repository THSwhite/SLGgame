import terrainJson from './terrain.json';
import balanceJson from './balance.json';
import buildingsJson from './buildings.json';
import techJson from './tech.json';
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
  loyalty: {
    max: number;
    start: number;
    decayPerSecond: number;
    recoverPerSecond: number;
    threshold: number;
    defectChancePerSecond: number;
    subvertRange: number;
    afterDefection: number;
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
  placement: 'land' | 'farmable';
  /**
   * Territory rule: 'connected' = territory building whose area must connect
   * to existing territory; 'near' = may stand up to N tiles outside territory;
   * 'foreign' = must stand in the territory of a nation we have relations with.
   */
  territory: 'none' | 'connected' | 'near' | 'foreign';
  territoryRadius: number;
  visionRadius: number;
  popCap: number;
  workerSlots: number;
  /** Resources per second per worker. */
  production: Partial<Record<ResourceType, number>>;
  freshWaterBonus?: number;
  nonStoneMultiplier?: number;
  /** Overrides nonTerritoryBuildingMaxDistance for 'near' buildings. */
  maxOutsideDistance?: number;
  trainingSlots: number;
  garrisonSlots: number;
  /** Territory and vision only work while soldiers are garrisoned. */
  requiresGarrison?: boolean;
  /** Research points per second per worker. */
  researchPerWorker?: number;
}

export const BUILDINGS = buildingsJson as Record<BuildingType, BuildingDef>;
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];

/** Additive effect values; see DEFAULT_MODIFIERS in modifiers.ts. */
export type Effects = Record<string, number>;

export interface TechDef {
  name: string;
  cost: number;
  requires: string[];
  description: string;
  effects: Effects;
}
export const TECHS = techJson as Record<string, TechDef>;

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
