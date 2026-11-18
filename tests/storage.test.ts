import { describe, expect, it } from 'vitest';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { hexDistance, tilesInRadius } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { villagerRate } from '../src/sim/economy';
import { capitalOf, deposit, storesOf, transportFactor, withdraw } from '../src/sim/storage';
import { getRelation, setStatus } from '../src/sim/systems/diplomacy';
import { newVillager } from '../src/sim/state';
import { addBuilding, exploreAll, ok, run, setStock, startAt } from './helpers';
import type { GameState } from '../src/sim/types';

function landAt(s: GameState, dist: number, from = s.players[0].startTile, pred: (i: number) => boolean = () => true): number {
  const t = s.tiles.findIndex(
    (tile, i) => TERRAIN[tile.terrain].land && hexDistance(s, i, from) === dist && !s.buildings.some((b) => b.tile === i) && pred(i),
  );
  expect(t).toBeGreaterThanOrEqual(0);
  return t;
}

function warehouse(s: GameState, tile: number, owner = 0) {
  const id = addBuilding(s, 'warehouse', tile, owner);
  return s.buildings.find((b) => b.id === id)!;
}

describe('stores', () => {
  it('the starting stock sits in the capital, and the nation total is the sum of its stores', () => {
    const s = startAt();
    const capital = capitalOf(s, 0)!;
    expect(capital.store).toEqual({ ...BALANCE.startingStock });
    const w = warehouse(s, landAt(s, 2));
    deposit(s, 0, w.tile, 'stone', 30);
    expect(s.players[0].stock.stone).toBe(30);
    expect(s.players[0].stock.wood).toBe(BALANCE.startingStock.wood);
  });

  it('goods go to the nearest store with room; overflow goes further; full storage stops income', () => {
    const s = startAt();
    const capital = capitalOf(s, 0)!;
    const w = warehouse(s, landAt(s, 2));
    const cap = BUILDINGS.warehouse.storage!;
    expect(deposit(s, 0, w.tile, 'stone', cap + 50)).toBe(cap + 50);
    expect(w.store!.stone).toBe(cap);
    expect(capital.store!.stone).toBe(50);
    // Fill everything: further deposits are lost.
    capital.store!.stone = BUILDINGS.camp.storage!;
    expect(deposit(s, 0, w.tile, 'stone', 10)).toBe(0);
  });

  it('income is lower the farther the job is from the nearest store', () => {
    const s = startAt();
    exploreAll(s);
    const [near, far] = [1, 5].map((d) => landAt(s, d, s.players[0].startTile, (i) => s.tiles[i].deposits.length === 0));
    for (const t of [near, far]) s.tiles[t].deposits = [{ resource: 'wood', amount: 500 }];
    const [a, b] = s.villagers;
    a.tile = near;
    b.tile = far;
    a.order = { kind: 'gather', target: near, resource: 'wood' };
    b.order = { kind: 'gather', target: far, resource: 'wood' };
    const ra = villagerRate(s, a).wood;
    const rb = villagerRate(s, b).wood;
    expect(rb).toBeLessThan(ra);
    expect(rb / ra).toBeCloseTo(transportFactor(5) / transportFactor(1), 9);
  });

  it('spending takes from the nearest store first', () => {
    const s = startAt();
    const capital = capitalOf(s, 0)!;
    const w = warehouse(s, landAt(s, 3));
    w.store!.wood = 40;
    capital.store!.wood = 100;
    withdraw(s, 0, w.tile, { wood: 60 });
    expect(w.store!.wood).toBe(0);
    expect(capital.store!.wood).toBe(80);
    expect(s.players[0].stock.wood).toBe(80);
  });

  it('villagers eat from the store nearest to them', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    const capital = capitalOf(s, 0)!;
    const far = landAt(s, 6);
    const w = warehouse(s, far);
    w.store!.food = 50;
    for (const v of s.villagers) v.tile = far;
    const before = capital.store!.food;
    run(s, 10);
    expect(capital.store!.food).toBe(before);
    expect(w.store!.food).toBeLessThan(50);
  });
});

describe('construction logistics', () => {
  it('materials need time to arrive; the farther the store, the longer', () => {
    const s = startAt();
    exploreAll(s);
    setStock(s, 0, { wood: 300 });
    const near = landAt(s, 1, s.players[0].startTile, (i) => TERRAIN[s.tiles[i].terrain].farmable);
    ok(s, { type: 'placeBuilding', player: 0, villager: s.villagers[0].id, tile: near, building: 'farm' });
    const site = s.buildings.find((b) => b.type === 'farm')!;
    const full = Math.round(1 * BALANCE.transport.deliverySecondsPerTile * BALANCE.ticksPerSecond);
    // Set when ordered, already counting down by the end of that tick.
    expect(site.delivery).toBe(full - 1);
    // The builder is right there, but nothing happens until delivery.
    s.villagers[0].tile = near;
    s.villagers[0].path = [];
    run(s, 0.5);
    expect(site.progress).toBe(0);
    run(s, BALANCE.transport.deliverySecondsPerTile + 1);
    expect(site.progress).toBeGreaterThan(0);
  });
});

describe('population spawn city', () => {
  it('new villagers appear at the chosen city and are paid from its store first', () => {
    const s = startAt();
    const p = s.players[0];
    const cityTile = landAt(s, 6);
    const cityId = addBuilding(s, 'city', cityTile);
    const city = s.buildings.find((b) => b.id === cityId)!;
    city.store!.food = 200;
    expect(validateCommand(s, { type: 'setManagement', player: 0, settings: { spawnAt: s.buildings.find((b) => b.type === 'farm')?.id ?? 99999 } })).not.toBeNull();
    ok(s, { type: 'setManagement', player: 0, settings: { spawnAt: cityId, foodProtection: false, popIntervalSeconds: 10 } });
    const before = s.villagers.length;
    run(s, 11);
    const born = s.villagers.slice(before);
    expect(born.length).toBeGreaterThan(0);
    expect(born[0].tile).toBe(cityTile);
    expect(city.store!.food).toBeLessThan(200 - BALANCE.population.foodCostPerVillager + 1);
    expect(p.stock.food).toBeGreaterThan(0);
  });
});

describe('transport', () => {
  it('a villager carries one resource between stores, up to the carry capacity', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    const capital = capitalOf(s, 0)!;
    const w = warehouse(s, landAt(s, 3));
    setStock(s, 0, { stone: 200 });
    const v = s.villagers[0];
    ok(s, { type: 'transport', player: 0, villager: v.id, from: capital.id, to: w.id, resource: 'stone', amount: 999 });
    run(s, 2);
    expect(v.cargo).toEqual({ resource: 'stone', amount: BALANCE.transport.carryCapacity });
    expect(capital.store!.stone).toBe(200 - BALANCE.transport.carryCapacity);
    run(s, 30);
    expect(v.cargo).toBeNull();
    expect(w.store!.stone).toBe(BALANCE.transport.carryCapacity);
    expect(s.players[0].stock.stone).toBe(200);
  });

  it('if the carrier is killed, the goods go to the killer', () => {
    const s = startAt(undefined, 2);
    for (const p of s.players) {
      p.ai = null;
      p.management.popEnabled = false;
    }
    getRelation(s, 0, 1).contact = true;
    setStatus(s, getRelation(s, 0, 1), 'war');
    const tile = s.tiles.findIndex((t) => TERRAIN[t.terrain].land && t.owner === -1 && t.terrain === 'grass');
    const carrier = newVillager(s, 0, tile);
    carrier.cargo = { resource: 'stone', amount: 40 };
    const raider = newVillager(s, 1, tile);
    raider.level = 2;
    raider.soldier = true;
    raider.hp = 100;
    const stone = s.players[1].stock.stone;
    run(s, 20);
    expect(s.villagers.includes(carrier)).toBe(false);
    expect(s.players[1].stock.stone).toBe(stone + 40);
  });

  it('cannot transport between foreign or identical stores', () => {
    const s = startAt();
    const capital = capitalOf(s, 0)!;
    const v = s.villagers[0];
    expect(validateCommand(s, { type: 'transport', player: 0, villager: v.id, from: capital.id, to: capital.id, resource: 'food', amount: 10 })).toMatch(/相同/);
    expect(storesOf(s, 0)).toHaveLength(1);
    expect(tilesInRadius(s, capital.tile, 1).length).toBeGreaterThan(0);
  });
});
