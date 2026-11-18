import { describe, expect, it } from 'vitest';
import { createGame, stepGame, TEST_MAP_SEED } from '../src/sim/game';
import { BALANCE, TERRAIN } from '../src/sim/data';
import { hexDistance, neighbors, tilesInRadius } from '../src/sim/hex';
import { findPath } from '../src/sim/pathfinding';
import { validateCommand } from '../src/sim/commands';
import { Knowledge, type GameState } from '../src/sim/types';

function newGame(): GameState {
  return createGame({ seed: TEST_MAP_SEED, players: [{ name: '玩家', color: '#e53935', isAI: false }] });
}

/** A land tile with plenty of land around it. */
function findStart(state: GameState): number {
  for (let i = 0; i < state.tiles.length; i++) {
    const ring = tilesInRadius(state, i, 3);
    if (ring.length === 37 && ring.every((t) => TERRAIN[state.tiles[t].terrain].land)) return i;
  }
  throw new Error('no start tile');
}

function started(): GameState {
  const s = newGame();
  stepGame(s, [{ type: 'chooseStart', player: 0, tile: findStart(s) }]);
  return s;
}

function runSeconds(s: GameState, seconds: number) {
  for (let i = 0; i < seconds * BALANCE.ticksPerSecond; i++) stepGame(s);
}

describe('hex grid', () => {
  it('has 6 neighbours at distance 1 for interior tiles', () => {
    const grid = { width: 10, height: 10 };
    for (const center of [44, 55]) {
      const ns = neighbors(grid, center);
      expect(ns).toHaveLength(6);
      for (const n of ns) expect(hexDistance(grid, center, n)).toBe(1);
    }
  });
});

describe('map generation', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(newGame().tiles)).toBe(JSON.stringify(newGame().tiles));
  });
  it('has both land and ocean, with ocean on the border', () => {
    const s = newGame();
    const land = s.tiles.filter((t) => TERRAIN[t.terrain].land).length;
    expect(land).toBeGreaterThan(s.tiles.length * 0.3);
    expect(land).toBeLessThan(s.tiles.length * 0.85);
    expect(s.tiles[0].terrain).toBe('ocean');
  });
});

describe('starting', () => {
  it('rejects water as a start tile', () => {
    const s = newGame();
    expect(validateCommand(s, { type: 'chooseStart', player: 0, tile: 0 })).not.toBeNull();
  });
  it('creates a camp, 3 villagers, explored area and territory', () => {
    const s = started();
    const p = s.players[0];
    expect(s.phase).toBe('playing');
    expect(s.villagers).toHaveLength(3);
    expect(s.buildings.map((b) => b.type)).toEqual(['camp']);
    expect(p.knowledge[p.startTile]).toBe(Knowledge.Explored);
    expect(s.tiles[p.startTile].owner).toBe(0);
    expect(p.visible[p.startTile]).toBe(1);
    // Far away tiles stay unknown.
    const far = s.tiles.findIndex((_, i) => hexDistance(s, i, p.startTile) > 6);
    expect(p.knowledge[far]).toBe(Knowledge.Unknown);
  });
});

describe('villagers', () => {
  it('explore an unknown tile and reveal it', () => {
    const s = started();
    const p = s.players[0];
    const target = s.tiles.findIndex(
      (t, i) => TERRAIN[t.terrain].land && p.knowledge[i] === Knowledge.Unknown && hexDistance(s, i, p.startTile) === 3,
    );
    expect(target).toBeGreaterThanOrEqual(0);
    const v = s.villagers[0];
    expect(stepGame(s, [{ type: 'explore', player: 0, villager: v.id, tile: target }])).toEqual([null]);
    runSeconds(s, 30);
    expect(p.knowledge[target]).toBe(Knowledge.Explored);
    expect(v.tile).toBe(target);
    expect(v.order.kind).toBe('idle');
  });

  it('cannot gather on unexplored tiles', () => {
    const s = started();
    const p = s.players[0];
    const target = p.knowledge.findIndex((k, i) => k === Knowledge.Unknown && TERRAIN[s.tiles[i].terrain].land);
    const err = validateCommand(s, { type: 'gather', player: 0, villager: s.villagers[0].id, tile: target });
    expect(err).toBe('需要先探索該地塊');
  });

  it('gather resources into the stockpile and deplete the tile', () => {
    const s = started();
    const p = s.players[0];
    const target = tilesInRadius(s, p.startTile, 2).find((i) => s.tiles[i].deposits.length > 0);
    expect(target).toBeDefined();
    const deposit = s.tiles[target!].deposits[0];
    const before = p.stock[deposit.resource];
    const amountBefore = deposit.amount;
    stepGame(s, [{ type: 'gather', player: 0, villager: s.villagers[0].id, tile: target! }]);
    runSeconds(s, 20);
    const gained = p.stock[deposit.resource] - before;
    expect(gained).toBeGreaterThan(0);
    expect(amountBefore - deposit.amount).toBeCloseTo(gained, 6);
  });

  it('consume food over time', () => {
    const s = started();
    const food = s.players[0].stock.food;
    runSeconds(s, 60);
    // 3 LV1 villagers eat 1 food/min each.
    expect(food - s.players[0].stock.food).toBeCloseTo(3, 6);
  });

  it('path around water', () => {
    const s = newGame();
    const land = s.tiles.map((t, i) => (TERRAIN[t.terrain].land ? i : -1)).filter((i) => i >= 0);
    const path = findPath(s, land[0], land[land.length - 1]);
    if (path) for (const t of path) expect(TERRAIN[s.tiles[t].terrain].land).toBe(true);
  });
});

describe('determinism', () => {
  it('produces identical state for identical command streams', () => {
    const run = () => {
      const s = started();
      const p = s.players[0];
      const unknown = s.tiles.findIndex(
        (t, i) => TERRAIN[t.terrain].land && p.knowledge[i] === Knowledge.Unknown && hexDistance(s, i, p.startTile) === 4,
      );
      stepGame(s, [{ type: 'explore', player: 0, villager: s.villagers[1].id, tile: unknown }]);
      runSeconds(s, 40);
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});

describe('territory', () => {
  it('only covers land tiles', () => {
    const s = started();
    for (const t of s.tiles) if (t.owner !== -1) expect(TERRAIN[t.terrain].land).toBe(true);
  });
});
