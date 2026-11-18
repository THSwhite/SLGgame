/**
 * Lockstep multiplayer protocol. The server is a thin relay: it never runs
 * the simulation. Every SERVER_FRAME_MS it broadcasts one `step` with all
 * commands it received since the previous one; every client applies the same
 * steps to the same deterministic simulation, so all clients stay in sync.
 */
import type { Command } from '../sim/commands';
import type { GameSetup } from '../sim/game';

export const SERVER_FRAME_MS = 100;
export const DEFAULT_PORT = 8787;
export const MAX_PLAYERS = 4;
/** Clients report a state hash every this many frames, to detect desyncs. */
export const HASH_EVERY_FRAMES = 50;
export const MAX_CHAT_LENGTH = 120;

export const NATIONS = [
  { name: '赤焰王國', color: '#e53935' },
  { name: '藍月王國', color: '#1e88e5' },
  { name: '綠野聯邦', color: '#43a047' },
  { name: '金沙帝國', color: '#fdd835' },
];

export interface LobbyOptions {
  seed: number;
  mapSize: string;
  aiCount: number;
}

export interface LobbyPlayer {
  id: number;
  name: string;
}

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'options'; options: Partial<LobbyOptions> }
  | { t: 'start' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'speed'; speed: number }
  | { t: 'hash'; frame: number; hash: string }
  | { t: 'chat'; text: string };

export type ServerMessage =
  | { t: 'lobby'; code: string; you: number; host: number; players: LobbyPlayer[]; options: LobbyOptions }
  | { t: 'error'; message: string }
  | { t: 'start'; setup: GameSetup; you: number; speed: number }
  /** Apply `cmds`, then advance the simulation `n` ticks (n = 0 while paused). */
  | { t: 'step'; frame: number; n: number; cmds: Command[] }
  | { t: 'speed'; speed: number }
  | { t: 'left'; name: string }
  | { t: 'desync'; frame: number }
  | { t: 'chat'; player: number; text: string };
