import { describe, expect, it } from 'vitest';
import { BALANCE, BUILDINGS, TECHS, TERRAIN } from '../src/sim/data';
import { hexDistance, neighbors } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { findPath, isWater } from '../src/sim/pathfinding';
import { getRelation, setStatus } from '../src/sim/systems/diplomacy';
import { newVillager } from '../src/sim/state';
import { addBuilding, exploreAll, ok, run, setStock, startAt, soldier } from './helpers';
import type { GameState } from '../src/sim/types';

const land = (s: GameState, i: number) => TERRAIN[s.tiles[i].terrain].land;

/** Own territory tile on the coast without a building. */
function coastTile(s: GameState): number {
  const t = s.tiles.findIndex(
    (tile, i) => tile.owner === 0 && land(s, i) && neighbors(s, i).some((n) => isWater(s, n)) && !s.buildings.some((b) => b.tile === i),
  );
  expect(t).toBeGreaterThanOrEqual(0);
  return t;
}

/** A land tile that cannot be reached on foot from the capital. */
function otherShore(s: GameState): number {
  const start = s.players[0].startTile;
  const t = s.tiles.findIndex((_, i) => land(s, i) && findPath(s, start, i) === null && neighbors(s, i).some((n) => isWater(s, n)));
  expect(t).toBeGreaterThanOrEqual(0);
  return t;
}


describe('linear tech tree', () => {
  it('every tech after the first tier requires the previous one in its branch', () => {
    for (const [id, t] of Object.entries(TECHS)) {
      if (t.tier === 1) {
        expect(t.requires, id).toEqual([]);
        continue;
      }
      const prev = Object.entries(TECHS).find(([, x]) => x.branch === t.branch && x.tier === t.tier - 1);
      expect(prev, id).toBeDefined();
      expect(t.requires).toEqual([prev![0]]);
    }
  });
});

describe('shipping and ports', () => {
  it('a port needs the shipping tech and a coastal tile', () => {
    const s = startAt();
    exploreAll(s);
    setStock(s, 0, { wood: 500, stone: 500 });
    const v = s.villagers[0].id;
    const coast = coastTile(s);
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: coast, building: 'port' })).toMatch(/航運/);
    s.players[0].researched.push('shipping');
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: coast, building: 'port' })).toBeNull();
    const inland = s.tiles.findIndex((t, i) => t.owner === 0 && land(s, i) && neighbors(s, i).every((n) => land(s, n)) && !s.buildings.some((b) => b.tile === i));
    if (inland >= 0) {
      expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v, tile: inland, building: 'port' })).toMatch(/海邊/);
    }
    expect(BUILDINGS.port.territoryRadius).toBeGreaterThan(0);
  });

  it('without a port the other shore is unreachable; with shipping + port villagers sail there', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    exploreAll(s);
    const target = otherShore(s);
    const v = s.villagers[0];
    expect(validateCommand(s, { type: 'move', player: 0, villager: v.id, tile: target })).toMatch(/無法抵達/);

    s.players[0].researched.push('shipping');
    const portTile = coastTile(s);
    addBuilding(s, 'port', portTile);
    const path = findPath(s, v.tile, target, { owner: 0 });
    expect(path).not.toBeNull();
    // The sea leg starts at our port.
    const firstWater = path!.findIndex((t) => isWater(s, t));
    expect(firstWater).toBeGreaterThan(0);
    expect(path![firstWater - 1]).toBe(portTile);

    ok(s, { type: 'move', player: 0, villager: v.id, tile: target });
    for (let i = 0; i < 600 && v.tile !== target; i++) run(s, 1);
    expect(v.tile).toBe(target);
  });
});

describe('navy', () => {
  function withHarbor() {
    const s = startAt(undefined, 2);
    for (const p of s.players) {
      p.ai = null;
      p.management.popEnabled = false;
    }
    s.players[0].researched.push('shipping');
    const portTile = coastTile(s);
    const port = addBuilding(s, 'port', portTile);
    setStock(s, 0, { wood: 500, food: 500 });
    return { s, port, portTile };
  }

  it('needs the shipwright tech, then turns an LV2 soldier into navy at a port', () => {
    const { s, port } = withHarbor();
    const v = soldier(s, 0, s.players[0].startTile);
    expect(validateCommand(s, { type: 'trainNavy', player: 0, villager: v.id, building: port })).toMatch(/造艦/);
    s.players[0].researched.push('shipwright');
    const civ = s.villagers.find((x) => x.owner === 0 && !x.soldier)!;
    expect(validateCommand(s, { type: 'trainNavy', player: 0, villager: civ.id, building: port })).toMatch(/LV2 士兵/);
    const wood = s.players[0].stock.wood;
    ok(s, { type: 'trainNavy', player: 0, villager: v.id, building: port });
    run(s, BALANCE.naval.navy.trainSeconds + 20);
    expect(v.naval).toBe(true);
    expect(v.hp).toBe(BALANCE.naval.navy.hp);
    expect(s.players[0].stock.wood).toBeLessThanOrEqual(wood - BALANCE.naval.navy.cost.wood!);
  });

  it('moves on water and own ports only', () => {
    const { s, portTile } = withHarbor();
    const navy = soldier(s, 0, portTile);
    navy.naval = true;
    const sea = neighbors(s, portTile).find((n) => isWater(s, n))!;
    expect(validateCommand(s, { type: 'move', player: 0, villager: navy.id, tile: sea })).toBeNull();
    const inland = s.players[0].startTile;
    expect(validateCommand(s, { type: 'move', player: 0, villager: navy.id, tile: inland })).toMatch(/水上/);
    expect(validateCommand(s, { type: 'setSoldier', player: 0, villager: navy.id, soldier: false })).toMatch(/海軍/);
  });

  it('only navy can fight at sea', () => {
    const { s, portTile } = withHarbor();
    getRelation(s, 0, 1).contact = true;
    setStatus(s, getRelation(s, 0, 1), 'war');
    const sea = s.tiles.findIndex((_, i) => isWater(s, i) && hexDistance(s, i, portTile) >= 3 && neighbors(s, i).every((n) => isWater(s, n)));
    // An enemy transport (civilian at sea) next to our land soldier at sea: no fight.
    const enemy = newVillager(s, 1, sea);
    const marine = soldier(s, 0, sea);
    run(s, 5);
    expect(enemy.hp).toBe(BALANCE.combat.hp['1']);
    expect(marine.hp).toBe(BALANCE.combat.hp['2']);
    // Our navy sinks it.
    const navy = soldier(s, 0, sea);
    navy.naval = true;
    run(s, 20);
    expect(s.villagers.includes(enemy)).toBe(false);
    // Land soldiers cannot even order an attack at sea.
    expect(validateCommand(s, { type: 'attack', player: 0, villager: marine.id, tile: sea })).toMatch(/海上/);
  });
});
