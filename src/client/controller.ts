import { BALANCE } from '../sim/data';
import { applyCommand, validateCommand, type Command } from '../sim/commands';
import { createGame, stepGame, TEST_MAP_SEED } from '../sim/game';
import type { GameState, PlayerId } from '../sim/types';

export const SPEEDS = [0, 1, 2, 5] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Selection {
  villager: number | null;
  tile: number | null;
}

/**
 * Owns the running game on the client: real time -> fixed ticks, the
 * command queue, speed and UI selection. In multiplayer, the queue is
 * what will be exchanged between peers each tick.
 */
export class GameController {
  state: GameState;
  readonly localPlayer: PlayerId = 0;
  speed: Speed = 1;
  selection: Selection = { villager: null, tile: null };
  lastError: string | null = null;

  private pending: Command[] = [];
  private accumulator = 0;
  private listeners = new Set<() => void>();

  constructor(seed = TEST_MAP_SEED) {
    this.state = createGame({
      seed,
      players: [{ name: '我的國家', color: '#e53935', isAI: false }],
    });
  }

  get tickMs(): number {
    return 1000 / BALANCE.ticksPerSecond;
  }

  /** Validate and queue a command for the next tick. Returns the error, if any. */
  issue(cmd: Command): string | null {
    const error = validateCommand(this.state, cmd);
    this.lastError = error;
    if (!error) {
      if (this.state.phase === 'choosingStart') stepGame(this.state, [cmd]);
      else this.pending.push(cmd);
    }
    this.notify();
    return error;
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    this.notify();
  }

  select(sel: Partial<Selection>) {
    this.selection = { ...this.selection, ...sel };
    this.lastError = null;
    this.notify();
  }

  /** Advance by real elapsed milliseconds. */
  update(dtMs: number) {
    if (this.state.phase !== 'playing') return;
    if (this.speed === 0) {
      // Still flush commands while paused so orders show up immediately.
      if (this.pending.length) this.flush();
      return;
    }
    this.accumulator += Math.min(dtMs, 250) * this.speed;
    let steps = 0;
    while (this.accumulator >= this.tickMs && steps < 50) {
      this.flush();
      this.accumulator -= this.tickMs;
      steps++;
    }
  }

  private flush() {
    const cmds = this.pending;
    this.pending = [];
    if (this.speed === 0) {
      // Apply without advancing time.
      for (const c of cmds) applyCommand(this.state, c);
      return;
    }
    stepGame(this.state, cmds);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }
}
