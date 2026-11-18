import { BALANCE, BUILDINGS, TERRAIN } from '../data';
import { logEvent, secondsToTicks } from '../state';
import type { GameState, Player } from '../types';
import { relationsOf, setStatus } from './diplomacy';
import { isComplete, recomputeTerritory } from './territory';

/** National strength, used for the time-limit victory and rankings. */
export function nationScore(state: GameState, p: Player): number {
  if (p.eliminated) return 0;
  const pop = state.villagers.filter((v) => v.owner === p.id).length;
  const land = state.tiles.filter((t) => t.owner === p.id).length;
  const buildings = state.buildings.filter((b) => b.owner === p.id && isComplete(b)).length;
  return pop * 10 + land * 2 + buildings * 5 + (p.researched.length + p.policies.length) * 15;
}

export function landShare(state: GameState, p: Player): number {
  const land = state.tiles.filter((t) => TERRAIN[t.terrain].land).length;
  return state.tiles.filter((t) => t.owner === p.id).length / Math.max(1, land);
}

function eliminate(state: GameState, p: Player) {
  p.eliminated = true;
  state.villagers = state.villagers.filter((v) => v.owner !== p.id);
  state.buildings = state.buildings.filter((b) => b.owner !== p.id);
  for (const rel of relationsOf(state, p.id)) if (rel.status !== 'none') setStatus(state, rel, 'none');
  recomputeTerritory(state);
  for (const other of state.players) logEvent(state, other.id, `${p.name} 滅亡了`);
}

/** Runs once per second: eliminations, then victory conditions. */
export function runVictory(state: GameState): void {
  if (state.tick % BALANCE.ticksPerSecond !== 0 || state.phase !== 'playing') return;

  for (const p of state.players) {
    if (p.eliminated || p.startTile === -1) continue;
    const hasPeople = state.villagers.some((v) => v.owner === p.id);
    const hasLand = state.buildings.some((b) => b.owner === p.id && isComplete(b) && BUILDINGS[b.type].territoryRadius > 0);
    if (!hasPeople || !hasLand) eliminate(state, p);
  }

  const alive = state.players.filter((p) => !p.eliminated);
  const end = (winner: number | null, reason: NonNullable<GameState['result']>['reason']) => {
    state.result = { winner, reason, tick: state.tick };
    state.phase = 'ended';
  };

  if (state.players.filter((p) => !p.isAI).every((p) => p.eliminated)) return end(null, 'defeat');
  if (state.players.length > 1 && alive.length === 1) return end(alive[0].id, 'conquest');
  for (const p of alive) {
    if (landShare(state, p) >= BALANCE.victory.territoryShare) return end(p.id, 'territory');
  }
  if (state.tick >= secondsToTicks(BALANCE.victory.timeLimitMinutes * 60)) {
    const best = [...alive].sort((a, b) => nationScore(state, b) - nationScore(state, a) || a.id - b.id)[0];
    return end(best.id, 'time');
  }
}
