import { BALANCE } from '../sim/data';
import { NATIONS } from '../net/protocol';
import { cleanChat, MessageLog } from './log';
import { applyCommand, validateCommand, type Command } from '../sim/commands';
import { createGame, stepGame, TEST_MAP_SEED } from '../sim/game';
import type { GameState, PlayerId } from '../sim/types';

export const SPEEDS = [0, 1, 2, 5] as const;
export const MAX_AI = 3;
const AI_NATIONS = NATIONS.slice(1);
export type Speed = (typeof SPEEDS)[number];

export interface Selection {
  villager: number | null;
  tile: number | null;
  /** Extra villagers selected together (shift-click / select all soldiers). Includes `villager`. */
  group: number[];
}

export interface GameOptions {
  seed: number;
  aiCount: number;
  mapSize: string;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Owns the running game on the client: real time -> fixed ticks, the
 * command queue, speed and UI selection. In multiplayer, the queue is
 * what will be exchanged between peers each tick.
 */
export class GameController {
  state: GameState;
  localPlayer: PlayerId = 0;
  readonly isNetwork: boolean = false;
  speed: Speed = 1;
  selection: Selection = { villager: null, tile: null, group: [] };
  options: GameOptions;
  lastError: string | null = null;
  /** Set for the tutorial (see tutorial.ts). */
  tutorial: import('./tutorial').Tutorial | null = null;
  /** Event history and chat (client-only, not part of the simulation). */
  log = new MessageLog();
  /** UI hook (sound effects): called after every locally issued command. */
  onIssue: ((cmd: Command, error: string | null) => void) | null = null;

  protected pending: Command[] = [];
  protected accumulator = 0;
  private listeners = new Set<() => void>();

  constructor(options: Partial<GameOptions> = {}) {
    this.options = { seed: TEST_MAP_SEED, aiCount: 2, mapSize: 'medium', ...options };
    this.state = this.makeGame();
  }

  private makeGame(): GameState {
    const { seed, aiCount, mapSize } = this.options;
    return createGame({
      seed,
      mapSize,
      players: [
        { name: '我的國家', color: '#e53935', isAI: false },
        ...AI_NATIONS.slice(0, aiCount).map((n) => ({ ...n, isAI: true })),
      ],
    });
  }

  /** Start over (before choosing a start, or after the game ended) with new options. */
  newGame(options: Partial<GameOptions>) {
    this.options = { ...this.options, ...options };
    this.state = this.makeGame();
    this.selection = { villager: null, tile: null, group: [] };
    this.log = new MessageLog();
    this.pending = [];
    this.accumulator = 0;
    this.lastError = null;
    this.speed = 1;
    this.notify();
  }

  get aiCount(): number {
    return this.options.aiCount;
  }

  /** Villagers the next order applies to. */
  get orderTargets(): number[] {
    const { villager, group } = this.selection;
    if (group.length) return group;
    return villager === null ? [] : [villager];
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
    this.onIssue?.(cmd, error);
    this.notify();
    return error;
  }

  /** Send a chat message. Single player: it only shows up locally. */
  sendChat(text: string): void {
    const clean = cleanChat(text);
    if (!clean) return;
    this.log.addChat(this.state.tick, this.localPlayer, clean);
    this.notify();
  }

  setSpeed(speed: Speed) {
    this.speed = speed;
    this.notify();
  }

  select(sel: Partial<Selection>) {
    // Choosing a single villager clears any group, unless a group is given.
    if (sel.villager !== undefined && sel.group === undefined) sel = { ...sel, group: [] };
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

  notify(): void {
    for (const fn of this.listeners) fn();
  }
}
