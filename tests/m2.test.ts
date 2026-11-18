import { describe, expect, it } from 'vitest';
import { createGame, stepGame, TEST_MAP_SEED } from '../src/sim/game';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { hexDistance, neighbors, tilesInRadius } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { buildingRatePerWorker, incomePerMinute } from '../src/sim/economy';
import { foodConsumptionPerMinute } from '../src/sim/systems/food';
import { populationBlocked, populationCap } from '../src/sim/systems/population';
import { Knowledge, type GameState } from '../src/sim/types';
import type { Command } from '../src/sim/commands';

function startAt(predicate: (s: GameState, tile: number) => boolean): GameState {
  const s = createGame({ seed: TEST_MAP_SEED, players: [{ name: '玩家', color: '#e53935', isAI: false }] });
  for (let i = 0; i < s.tiles.length; i++) {
    const ring = tilesInRadius(s, i, 2);
    if (ring.length === 19 && ring.every((t) => TERRAIN[s.tiles[t].terrain].land) && predicate(s, i)) {
      stepGame(s, [{ type: 'chooseStart', player: 0, tile: i }]);
      return s;
    }
  }
  throw new Error('no start found');
}

const hasFarmland = (s: GameState, i: number) =>
  tilesInRadius(s, i, 2).filter((t) => TERRAIN[s.tiles[t].terrain].farmable).length >= 4;

function exploreAll(s: GameState) {
  s.players[0].knowledge.fill(Knowledge.Explored);
}

function run(s: GameState, seconds: number, cmds: Command[] = []) {
  stepGame(s, cmds);
  for (let i = 1; i < seconds * BALANCE.ticksPerSecond; i++) stepGame(s);
}

function ok(s: GameState, cmd: Command) {
  expect(validateCommand(s, cmd)).toBeNull();
  stepGame(s, [cmd]);
}

/** A farmable tile inside own territory with no building. */
function freeFarmland(s: GameState, exclude: number[] = []): number {
  const p = s.players[0];
  return tilesInRadius(s, p.startTile, 2).find(
    (t) =>
      TERRAIN[s.tiles[t].terrain].farmable &&
      !s.buildings.some((b) => b.tile === t) &&
      !exclude.includes(t),
  )!;
}

describe('building placement', () => {
  it('requires explored, suitable land', () => {
    const s = startAt(hasFarmland);
    const v = s.villagers[0].id;
    const unexplored = s.players[0].knowledge.findIndex((k, i) => k === 0 && TERRAIN[s.tiles[i].terrain].land);
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: unexplored, building: 'farm' })).toBe(
      '需要先探索該地塊',
    );
    const camp = s.players[0].startTile;
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: camp, building: 'mine' })).toBe(
      '這裡已經有建築了',
    );
    exploreAll(s);
    const rocky = s.tiles.findIndex((t, i) => !TERRAIN[t.terrain].farmable && TERRAIN[t.terrain].land && hexDistance(s, i, camp) <= 4);
    if (rocky >= 0) {
      expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: rocky, building: 'farm' })).toMatch(
        /可耕作/,
      );
    }
  });

  it('limits non-territory buildings to near the border', () => {
    const s = startAt(hasFarmland);
    exploreAll(s);
    s.players[0].stock.wood = 1000;
    const camp = s.players[0].startTile;
    const v = s.villagers[0].id;
    const far = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, camp) === 2 + BALANCE.nonTerritoryBuildingMaxDistance + 2);
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: far, building: 'mine' })).toMatch(/國土外/);
    const near = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, camp) === 2 + BALANCE.nonTerritoryBuildingMaxDistance);
    if (near >= 0) expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: near, building: 'mine' })).toBeNull();
  });

  it('requires territory buildings to connect to territory', () => {
    const s = startAt(hasFarmland);
    exploreAll(s);
    s.players[0].stock.wood = 1000;
    const camp = s.players[0].startTile;
    const v = s.villagers[0].id;
    // Radius 1 house: territory edge is distance 2, so distance 4 just touches, 5 is disconnected.
    const touching = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, camp) === 4);
    const detached = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, camp) === 5);
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: touching, building: 'house' })).toBeNull();
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: detached, building: 'house' })).toBe(
      '國土建築必須與現有國土相連',
    );
  });

  it('charges the cost and rejects when unaffordable', () => {
    const s = startAt(hasFarmland);
    const tile = freeFarmland(s);
    const wood = s.players[0].stock.wood;
    ok(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile, building: 'farm' });
    expect(s.players[0].stock.wood).toBe(wood - BUILDINGS.farm.cost.wood!);
    s.players[0].stock.wood = 0;
    expect(
      validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[1].id, tile: freeFarmland(s), building: 'farm' }),
    ).toMatch(/資源不足/);
  });
});

describe('construction and work', () => {
  it('builds a farm, then the builder farms food', () => {
    const s = startAt(hasFarmland);
    s.players[0].management.popEnabled = false;
    const tile = freeFarmland(s);
    const v = s.villagers[0];
    ok(s, { type: 'placeBuilding', player: 0, villager: v.id, tile, building: 'farm' });
    run(s, BUILDINGS.farm.buildSeconds + 15);
    const farm = s.buildings.find((b) => b.type === 'farm')!;
    expect(farm.progress).toBe(1);
    expect(v.order).toEqual({ kind: 'work', building: farm.id });
    expect(incomePerMinute(s, s.players[0]).food).toBeGreaterThan(0);
  });

  it('two builders build faster than one', () => {
    const time = (builders: number) => {
      const s = startAt(hasFarmland);
      const tile = freeFarmland(s);
      ok(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile, building: 'farm' });
      const id = s.buildings.find((b) => b.type === 'farm')!.id;
      for (let i = 1; i < builders; i++) ok(s, { type: 'work', player: 0, villager: s.villagers[i].id, building: id });
      let ticks = 0;
      while (s.buildings.find((b) => b.id === id)!.progress < 1 && ticks < 10000) {
        stepGame(s);
        ticks++;
      }
      return ticks;
    };
    expect(time(2)).toBeLessThan(time(1));
  });

  it('enforces worker slots', () => {
    const s = startAt(hasFarmland);
    const tile = freeFarmland(s);
    s.buildings.push({ id: 999, type: 'farm', owner: 0, tile, progress: 1, hp: 100 });
    ok(s, { type: 'work', player: 0, villager: s.villagers[0].id, building: 999 });
    ok(s, { type: 'work', player: 0, villager: s.villagers[1].id, building: 999 });
    expect(validateCommand(s, { type: 'work', player: 0, villager: s.villagers[2].id, building: 999 })).toMatch(/已滿/);
  });

  it('gives farms a fresh-water bonus and mines a non-stone penalty', () => {
    const s = startAt(hasFarmland);
    const lakeSide = s.tiles.findIndex(
      (t, i) => TERRAIN[t.terrain].farmable && neighbors(s, i).some((n) => s.tiles[n].terrain === 'lake'),
    );
    const dry = s.tiles.findIndex(
      (t, i) => TERRAIN[t.terrain].farmable && neighbors(s, i).every((n) => !TERRAIN[s.tiles[n].terrain].freshWater),
    );
    const wet = buildingRatePerWorker(s, { id: 1, type: 'farm', owner: 0, tile: lakeSide, progress: 1, hp: 100 }).food;
    const plain = buildingRatePerWorker(s, { id: 2, type: 'farm', owner: 0, tile: dry, progress: 1, hp: 100 }).food;
    expect(lakeSide).toBeGreaterThanOrEqual(0);
    expect(wet).toBeCloseTo(plain * (1 + BUILDINGS.farm.freshWaterBonus!), 9);

    const stone = s.tiles.findIndex((t) => t.terrain === 'stone');
    const grass = s.tiles.findIndex((t) => t.terrain === 'grass');
    const onStone = buildingRatePerWorker(s, { id: 3, type: 'mine', owner: 0, tile: stone, progress: 1, hp: 100 }).stone;
    const offStone = buildingRatePerWorker(s, { id: 4, type: 'mine', owner: 0, tile: grass, progress: 1, hp: 100 }).stone;
    expect(offStone).toBeCloseTo(onStone * BUILDINGS.mine.nonStoneMultiplier!, 9);
  });

  it('a finished house raises the population cap and expands territory', () => {
    const s = startAt(hasFarmland);
    exploreAll(s);
    s.players[0].stock.wood = 1000;
    const camp = s.players[0].startTile;
    const tile = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, camp) === 3);
    const capBefore = populationCap(s, s.players[0]);
    const ownedBefore = s.tiles.filter((t) => t.owner === 0).length;
    ok(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile, building: 'house' });
    run(s, BUILDINGS.house.buildSeconds + 20);
    expect(populationCap(s, s.players[0])).toBe(capBefore + BUILDINGS.house.popCap);
    expect(s.tiles.filter((t) => t.owner === 0).length).toBeGreaterThan(ownedBefore);
    expect(s.tiles[tile].owner).toBe(0);
  });
});

describe('population', () => {
  it('does not grow without enough food income (food protection)', () => {
    const s = startAt(hasFarmland);
    expect(populationBlocked(s, s.players[0])).toBe('糧食收入不足以養活更多人口');
    run(s, 60);
    expect(s.villagers).toHaveLength(3);
  });

  it('grows at the configured interval when food income allows, up to the cap', () => {
    const s = startAt(hasFarmland);
    s.players[0].stock.food = 1000;
    const p = s.players[0];
    ok(s, { type: 'setManagement', player: 0, settings: { popIntervalSeconds: 10 } });
    // Two farms with two workers each.
    const t1 = freeFarmland(s);
    const t2 = freeFarmland(s, [t1]);
    s.buildings.push({ id: 900, type: 'farm', owner: 0, tile: t1, progress: 1, hp: 100 });
    s.buildings.push({ id: 901, type: 'farm', owner: 0, tile: t2, progress: 1, hp: 100 });
    ok(s, { type: 'work', player: 0, villager: s.villagers[0].id, building: 900 });
    ok(s, { type: 'work', player: 0, villager: s.villagers[1].id, building: 900 });
    ok(s, { type: 'work', player: 0, villager: s.villagers[2].id, building: 901 });
    run(s, 15);
    expect(s.villagers.length).toBeGreaterThanOrEqual(4);
    run(s, 60);
    expect(s.villagers.length).toBe(populationCap(s, p));
    expect(populationBlocked(s, p)).toMatch(/人口上限/);
  });

  it('with food protection, every birth keeps food income >= consumption', () => {
    const s = startAt(hasFarmland);
    const p = s.players[0];
    p.stock.food = 1000;
    p.management.popIntervalSeconds = 10;
    s.buildings.push({ id: 900, type: 'farm', owner: 0, tile: freeFarmland(s), progress: 1, hp: 100 });
    ok(s, { type: 'work', player: 0, villager: s.villagers[0].id, building: 900 });
    let count = s.villagers.length;
    for (let i = 0; i < 120 * BALANCE.ticksPerSecond; i++) {
      stepGame(s);
      if (s.villagers.length !== count) {
        count = s.villagers.length;
        expect(incomePerMinute(s, p).food).toBeGreaterThanOrEqual(foodConsumptionPerMinute(s, p));
      }
    }
  });

  it('rejects intervals outside the allowed range', () => {
    const s = startAt(hasFarmland);
    expect(validateCommand(s, { type: 'setManagement', player: 0, settings: { popIntervalSeconds: 1 } })).not.toBeNull();
  });
});
