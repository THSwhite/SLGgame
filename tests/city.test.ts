import { describe, expect, it } from 'vitest';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { hexDistance, tilesInRadius } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { cityLimit, independenceChance, independenceThreshold } from '../src/sim/systems/cities';
import { recomputeTerritory } from '../src/sim/systems/territory';
import { populationCap } from '../src/sim/systems/population';
import { newVillager } from '../src/sim/state';
import { addBuilding, exploreAll, ok, run, startAt } from './helpers';
import type { GameState } from '../src/sim/types';

function rich(s: GameState) {
  const p = s.players[0];
  p.stock.wood = 5000;
  p.stock.stone = 5000;
  p.stock.food = 5000;
  p.management.popEnabled = false;
  exploreAll(s);
}

/** Give the player enough territory for `n` cities by adding (complete) houses around the camp. */
function growTerritory(s: GameState, cities: number) {
  const need = cities * BALANCE.branchCity.territoryTilesPerCity;
  const start = s.players[0].startTile;
  for (const t of tilesInRadius(s, start, 5)) {
    if (s.tiles.filter((x) => x.owner === 0).length >= need) break;
    if (!TERRAIN[s.tiles[t].terrain].land || s.buildings.some((b) => b.tile === t) || hexDistance(s, t, start) < 3) continue;
    addBuilding(s, 'house', t);
    recomputeTerritory(s);
  }
  expect(cityLimit(s, s.players[0])).toBeGreaterThanOrEqual(cities);
}

/** Unclaimed explored land at the given distance from the start. */
function wildTile(s: GameState, dist: number): number {
  const start = s.players[0].startTile;
  const t = s.tiles.findIndex(
    (tile, i) =>
      TERRAIN[tile.terrain].land &&
      tile.owner === -1 &&
      hexDistance(s, i, start) === dist &&
      tilesInRadius(s, i, 1).every((n) => TERRAIN[s.tiles[n].terrain].land),
  );
  expect(t).toBeGreaterThanOrEqual(0);
  return t;
}

describe('branch city', () => {
  it('is limited by territory size (none at the start)', () => {
    const s = startAt();
    rich(s);
    expect(cityLimit(s, s.players[0])).toBe(0);
    const err = validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile: wildTile(s, 7), building: 'city' });
    expect(err).toMatch(/分城數量已達上限/);
  });

  it('can be placed far from territory without connecting, but not on foreign land', () => {
    const s = startAt(undefined, 2);
    for (const p of s.players) p.ai = null;
    rich(s);
    growTerritory(s, 1);
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile: wildTile(s, 8), building: 'city' })).toBeNull();
    const foreign = s.tiles.findIndex((t, i) => t.owner === 1 && !s.buildings.some((b) => b.tile === i));
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile: foreign, building: 'city' })).toBe(
      '這是其他國家的國土',
    );
  });

  it('only progresses with at least 3 villagers around, then gives territory and population room', () => {
    const s = startAt();
    rich(s);
    growTerritory(s, 1);
    const tile = wildTile(s, 6);
    const v = s.villagers.filter((x) => x.owner === 0);
    ok(s, { type: 'placeBuilding', player: 0, villager: v[0].id, tile, building: 'city' });
    const city = s.buildings.find((b) => b.type === 'city')!;
    // One builder alone cannot make progress, even after arriving.
    v[0].tile = tile;
    v[0].path = [];
    run(s, 10);
    expect(city.progress).toBe(0);
    // Two more villagers on neighbouring tiles: work starts.
    const around = tilesInRadius(s, tile, 1).filter((t) => t !== tile);
    for (const t of around.slice(0, 2)) newVillager(s, 0, t);
    const capBefore = populationCap(s, s.players[0]);
    run(s, BUILDINGS.city.buildSeconds * 2);
    expect(city.progress).toBe(1);
    expect(s.tiles[tile].owner).toBe(0);
    expect(populationCap(s, s.players[0])).toBe(capBefore + BUILDINGS.city.popCap);
  });

  it('a city very far from the capital may break away as a new AI nation; a near one never does', () => {
    const s = startAt();
    rich(s);
    const start = s.players[0].startTile;
    const threshold = independenceThreshold(s);
    const farTile = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && t.owner === -1 && hexDistance(s, i, start) > threshold + 6);
    const nearTile = wildTile(s, 6);
    const far = addBuilding(s, 'city', farTile);
    const near = addBuilding(s, 'city', nearTile);
    expect(independenceChance(s, s.buildings.find((b) => b.id === near)!)).toBe(0);
    expect(independenceChance(s, s.buildings.find((b) => b.id === far)!)).toBeGreaterThan(0);
    const settler = newVillager(s, 0, farTile);
    const farCity = s.buildings.find((b) => b.id === far)!;
    for (let m = 0; m < 120 && farCity.owner === 0; m++) run(s, 60);
    // A new nation was born around the old city.
    expect(s.players).toHaveLength(2);
    const nation = s.players[1];
    expect(nation.isAI).toBe(true);
    expect(nation.ai).not.toBeNull();
    expect(farCity.owner).toBe(1);
    expect(farCity.type).toBe('camp');
    expect(settler.owner).toBe(1);
    expect(s.tiles[farTile].owner).toBe(1);
    expect(s.relations.some((r) => r.a === 0 && r.b === 1 && r.contact)).toBe(true);
    expect(s.buildings.find((b) => b.id === near)!.owner).toBe(0);
    expect(s.events.some((e) => e.message.includes('成立了'))).toBe(true);
    // ...and it runs as a normal nation afterwards.
    run(s, 120);
    expect(nation.eliminated).toBe(false);
  });
});
