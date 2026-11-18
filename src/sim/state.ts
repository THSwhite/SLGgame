import { BALANCE } from './data';
import type { GameState, PlayerId, TileIndex, Villager } from './types';

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
    hp: BALANCE.combat.hp['1'],
  };
  state.villagers.push(v);
  return v;
}

export function maxVillagerHp(level: number): number {
  return BALANCE.combat.hp[String(level)] ?? BALANCE.combat.hp['1'];
}
