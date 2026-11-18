import { expect } from 'vitest';
import { createGame, stepGame, TEST_MAP_SEED } from '../src/sim/game';
import { BALANCE, TERRAIN } from '../src/sim/data';
import { hexDistance, tilesInRadius } from '../src/sim/hex';
import { validateCommand, type Command } from '../src/sim/commands';
import { Knowledge, type GameState } from '../src/sim/types';
import { capitalOf, initStore, refreshStock, storesOf } from '../src/sim/storage';
import type { ResourceType } from '../src/sim/data';

export const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835'];

export function solidLand(s: GameState, i: number, r = 2): boolean {
  const ring = tilesInRadius(s, i, r);
  return ring.length === 1 + 3 * r * (r + 1) && ring.every((t) => TERRAIN[s.tiles[t].terrain].land);
}

export const hasFarmland = (s: GameState, i: number) =>
  tilesInRadius(s, i, 2).filter((t) => TERRAIN[s.tiles[t].terrain].farmable).length >= 4;

/** New single-player (or n-player) game; player 0 starts at the first good tile. */
export function startAt(predicate: (s: GameState, tile: number) => boolean = hasFarmland, players = 1): GameState {
  const s = createGame({
    seed: TEST_MAP_SEED,
    players: Array.from({ length: players }, (_, i) => ({ name: `國家${i}`, color: COLORS[i], isAI: i > 0 })),
  });
  const starts: number[] = [];
  for (let i = 0; i < s.tiles.length && starts.length < players; i++) {
    if (!solidLand(s, i) || !predicate(s, i)) continue;
    if (starts.some((t) => hexDistance(s, t, i) < 14)) continue;
    starts.push(i);
  }
  if (starts.length < players) throw new Error('no start found');
  stepGame(s, starts.map((tile, player) => ({ type: 'chooseStart', player, tile }) as Command));
  return s;
}

export function exploreAll(s: GameState, player = 0) {
  s.players[player].knowledge.fill(Knowledge.Explored);
}

export function run(s: GameState, seconds: number) {
  for (let i = 0; i < seconds * BALANCE.ticksPerSecond; i++) stepGame(s);
}

export function ok(s: GameState, cmd: Command) {
  expect(validateCommand(s, cmd)).toBeNull();
  stepGame(s, [cmd]);
}

/** Free land tile inside player's territory, optionally matching a predicate. */
export function freeTile(s: GameState, player = 0, pred: (i: number) => boolean = () => true, exclude: number[] = []): number {
  const p = s.players[player];
  const t = tilesInRadius(s, p.startTile, 2).find(
    (i) =>
      TERRAIN[s.tiles[i].terrain].land &&
      s.tiles[i].owner === player &&
      !s.buildings.some((b) => b.tile === i) &&
      !exclude.includes(i) &&
      pred(i),
  );
  if (t === undefined) throw new Error('no free tile');
  return t;
}

/** Add a completed building directly (for setting up tests). */
export function addBuilding(s: GameState, type: GameState['buildings'][number]['type'], tile: number, owner = 0) {
  const id = s.nextEntityId++;
  const b = { id, type, owner, tile, progress: 1, hp: 100 } as GameState['buildings'][number];
  initStore(b);
  s.buildings.push(b);
  return id;
}

/** Scripted setups: a nation now has exactly these amounts, all in its capital's store (ignoring capacity). */
export function setStock(s: GameState, owner: number, amounts: Partial<Record<ResourceType, number>>) {
  const capital = capitalOf(s, owner);
  if (!capital) throw new Error('no capital');
  for (const [r, v] of Object.entries(amounts) as Array<[ResourceType, number]>) {
    for (const b of storesOf(s, owner)) b.store![r] = 0;
    capital.store![r] = v;
  }
  refreshStock(s, s.players[owner]);
}
