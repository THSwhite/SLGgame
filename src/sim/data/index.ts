import terrainJson from './terrain.json';
import balanceJson from './balance.json';
import buildingsJson from './buildings.json';

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
   * to existing territory; 'near' = may stand up to N tiles outside territory.
   */
  territory: 'none' | 'connected' | 'near';
  territoryRadius: number;
  visionRadius: number;
  popCap: number;
  workerSlots: number;
  /** Resources per second per worker. */
  production: Partial<Record<ResourceType, number>>;
  freshWaterBonus?: number;
  nonStoneMultiplier?: number;
}

export const BUILDINGS = buildingsJson as Record<BuildingType, BuildingDef>;
export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[];
