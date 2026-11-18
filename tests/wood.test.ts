import { describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/game';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { tilesInRadius } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { adjacentForests, buildingRatePerWorker } from '../src/sim/economy';
import { addBuilding, exploreAll, ok, run, startAt } from './helpers';

describe('wood supply on the map', () => {
  it('almost every land tile has wood within 3 tiles, on many seeds', () => {
    for (const seed of [1, 2, 3, 42, 777, 20261118, 123456, 5555, 31337]) {
      const s = createGame({ seed, players: [{ name: 'a', color: '#fff', isAI: false }] });
      const land = s.tiles.map((_, i) => i).filter((i) => TERRAIN[s.tiles[i].terrain].land);
      const withWood = land.filter((i) =>
        tilesInRadius(s, i, 3).some((t) => s.tiles[t].deposits.some((d) => d.resource === 'wood')),
      ).length;
      expect(withWood / land.length).toBeGreaterThan(0.9);
      // Forest should not swallow the farmland.
      const forest = land.filter((i) => s.tiles[i].terrain === 'forest').length;
      expect(forest / land.length).toBeLessThan(0.45);
    }
  });

  it('open land sometimes carries wild wood', () => {
    const s = createGame({ seed: 42, players: [{ name: 'a', color: '#fff', isAI: false }] });
    expect(s.tiles.some((t) => t.terrain === 'grass' && t.deposits.some((d) => d.resource === 'wood'))).toBe(true);
  });
});

describe('lumber camp', () => {
  it('cannot be built on stone', () => {
    const s = startAt();
    exploreAll(s);
    s.players[0].stock.wood = 500;
    const stone = s.tiles.findIndex((t, i) => t.terrain === 'stone' && validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile: i, building: 'mine' }) === null);
    if (stone >= 0) {
      expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile: stone, building: 'lumber' })).toBe(
        '伐木場不能蓋在石地上',
      );
    }
    const s2 = startAt();
    const anyStone = s2.tiles.findIndex((t) => t.terrain === 'stone');
    s2.players[0].knowledge.fill(1);
    expect(
      validateCommand(s2, { type: 'placeBuilding', player: 0, villager: s2.villagers[0].id, tile: anyStone, building: 'lumber' }),
    ).not.toBeNull();
  });

  it('produces most in forest, plus a bonus per adjacent forest', () => {
    const s = startAt();
    const base = BUILDINGS.lumber.production.wood!;
    const forest = s.tiles.findIndex((t) => t.terrain === 'forest');
    const grass = s.tiles.findIndex((t) => t.terrain === 'grass');
    const rate = (tile: number) => buildingRatePerWorker(s, { id: 1, type: 'lumber', owner: 0, tile, progress: 1, hp: 1 }).wood;
    const bonus = (tile: number) => 1 + BUILDINGS.lumber.forestAdjacencyBonus! * adjacentForests(s, tile);
    expect(rate(forest)).toBeCloseTo(base * bonus(forest), 9);
    expect(rate(grass)).toBeCloseTo(base * BUILDINGS.lumber.nonForestMultiplier! * bonus(grass), 9);
    expect(rate(forest)).toBeGreaterThan(rate(grass));
  });

  it('workers produce wood without depleting the tile; forestry speeds it up', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    s.players[0].stock.food = 1000;
    const tile = tilesInRadius(s, s.players[0].startTile, 2).find(
      (i) => s.tiles[i].terrain !== 'stone' && TERRAIN[s.tiles[i].terrain].land && !s.buildings.some((b) => b.tile === i),
    )!;
    const id = addBuilding(s, 'lumber', tile);
    const b = s.buildings.find((x) => x.id === id)!;
    const before = buildingRatePerWorker(s, b).wood;
    s.players[0].researched.push('forestry');
    expect(buildingRatePerWorker(s, b).wood).toBeCloseTo(before * 1.3, 9);
    const deposits = JSON.stringify(s.tiles[tile].deposits);
    ok(s, { type: 'work', player: 0, villager: s.villagers[0].id, building: id });
    const wood = s.players[0].stock.wood;
    run(s, 30);
    expect(s.players[0].stock.wood).toBeGreaterThan(wood);
    expect(JSON.stringify(s.tiles[tile].deposits)).toBe(deposits);
  });

  it('starting wood covers a lumber camp and a farm', () => {
    expect(BALANCE.startingStock.wood).toBeGreaterThanOrEqual(BUILDINGS.lumber.cost.wood! + BUILDINGS.farm.cost.wood!);
  });
});
