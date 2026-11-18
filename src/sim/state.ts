import { BALANCE } from './data';
import type { GameState, PlayerId } from './types';

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
