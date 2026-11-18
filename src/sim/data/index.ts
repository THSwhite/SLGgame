import terrainJson from './terrain.json';
import balanceJson from './balance.json';

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
  camp: { territoryRadius: number; visionRadius: number; exploredRadius: number };
  villagerVisionRadius: number;
}

export const BALANCE = balanceJson as Balance;
