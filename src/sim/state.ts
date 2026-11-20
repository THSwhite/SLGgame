import { BALANCE, BUILDINGS } from './data';
import { Knowledge, type AIPersonality, type Building, type GameState, type Player, type PlayerId, type TileIndex, type Villager } from './types';
import { deposit } from './storage';

export const MAX_EVENTS = 100;

export function logEvent(state: GameState, player: PlayerId, message: string): void {
  state.events.push({ tick: state.tick, player, message });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * BALANCE.ticksPerSecond);
}

export function getPlayer(state: GameState, id: PlayerId) {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}


export function newVillager(state: GameState, owner: PlayerId, tile: TileIndex): Villager {
  const v: Villager = {
    id: state.nextEntityId++,
    owner,
    level: 1,
    tile,
    path: [],
    moveProgress: 0,
    order: { kind: 'idle' },
    soldier: false,
    loyalty: BALANCE.loyalty.start,
    resentment: 0,
    cargo: null,
    naval: false,
    hp: BALANCE.combat.hp['1'],
  };
  state.villagers.push(v);
  return v;
}

export function maxVillagerHp(level: number): number {
  return BALANCE.combat.hp[String(level)] ?? BALANCE.combat.hp['1'];
}

/** Max HP of a unit (navy has its own). */
export function unitMaxHp(v: Villager): number {
  return v.naval ? BALANCE.naval.navy.hp : maxVillagerHp(v.level);
}

export function makePlayer(
  id: PlayerId,
  setup: { name: string; color: string; isAI: boolean },
  tileCount: number,
  ai: AIPersonality | null,
): Player {
  return {
    id,
    name: setup.name,
    color: setup.color,
    isAI: setup.isAI,
    startTile: -1,
    stock: { food: 0, wood: 0, stone: 0, ore: 0 },
    knowledge: new Array(tileCount).fill(Knowledge.Unknown),
    visible: new Array(tileCount).fill(0),
    atWar: false,
    management: {
      popIntervalSeconds: BALANCE.population.defaultIntervalSeconds,
      popEnabled: true,
      foodProtection: true,
      spawnAt: null,
    },
    popProgress: 0,
    researched: [],
    policies: [],
    currentResearch: null,
    researchPoints: 0,
    ai,
    eliminated: false,
    capitalCrisis: null,
  };
}

/** Max HP of a building (some buildings have a reduced cap). */
export function buildingMaxHp(b: { type: keyof typeof BUILDINGS; maxHp?: number }): number {
  return b.maxHp ?? BUILDINGS[b.type].hp;
}

export function buildingById(state: GameState, id: number | null | undefined): Building | undefined {
  return id === null || id === undefined ? undefined : state.buildings.find((b) => b.id === id);
}

/** Capitals and branch cities: the seats that anchor regions, storage and population. */
export function isSeat(b: Building): boolean {
  return b.type === 'camp' || b.type === 'city';
}

/** Drop the current job and any movement in progress. */
export function resetOrders(v: Villager): void {
  v.order = { kind: 'idle' };
  v.path = [];
  v.moveProgress = 0;
}

/**
 * A villager changes nation (conquest, defection, independence...): disarmed,
 * no job, and goods they carry go to the new nation. The one place to update
 * when villagers gain new per-nation state.
 */
export function transferVillager(state: GameState, v: Villager, to: PlayerId, mood: { loyalty: number; resentment: number }): void {
  if (v.cargo) {
    deposit(state, to, v.tile, v.cargo.resource, v.cargo.amount);
    v.cargo = null;
  }
  v.owner = to;
  v.soldier = false;
  v.naval = false;
  resetOrders(v);
  v.resentment = mood.resentment;
  v.loyalty = Math.min(mood.loyalty, BALANCE.loyalty.max - mood.resentment);
}
