import { describe, expect, it } from 'vitest';
import { stepGame } from '../src/sim/game';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { hexDistance } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { buildingRatePerWorker } from '../src/sim/economy';
import { foodConsumptionPerMinute } from '../src/sim/systems/food';
import { isSupervised } from '../src/sim/systems/loyalty';
import { addBuilding, exploreAll, freeTile, ok, run, startAt } from './helpers';
import type { GameState } from '../src/sim/types';

function lv2(s: GameState, idx = 0) {
  const v = s.villagers.filter((x) => x.owner === 0)[idx];
  v.level = 2;
  return v;
}

describe('barracks training', () => {
  it('trains a villager to LV2 for food, and locks them while training', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    const id = addBuilding(s, 'barracks', freeTile(s));
    const v = s.villagers[0];
    const food = s.players[0].stock.food;
    ok(s, { type: 'train', player: 0, villager: v.id, building: id });
    run(s, 10);
    expect(v.order.kind).toBe('train');
    expect(validateCommand(s, { type: 'stop', player: 0, villager: v.id })).toBe('訓練期間不能做其他事情');
    run(s, BALANCE.training.seconds);
    expect(v.level).toBe(2);
    expect(v.order.kind).toBe('idle');
    // Paid the training fee (plus normal consumption).
    expect(food - s.players[0].stock.food).toBeGreaterThan(BALANCE.training.foodCost);
    expect(validateCommand(s, { type: 'train', player: 0, villager: v.id, building: id })).toBe('已經是最高等級');
  });

  it('LV2 villagers work faster than LV1', () => {
    const s = startAt();
    const farm = addBuilding(s, 'farm', freeTile(s, 0, (i) => TERRAIN[s.tiles[i].terrain].farmable));
    const a = s.villagers[0];
    const b = lv2(s, 1);
    ok(s, { type: 'work', player: 0, villager: a.id, building: farm });
    ok(s, { type: 'work', player: 0, villager: b.id, building: farm });
    const food0 = s.players[0].stock.food;
    run(s, 20);
    expect(s.players[0].stock.food).toBeGreaterThan(food0);
    expect(BALANCE.villagerLevels['2'].workEfficiency).toBeGreaterThan(BALANCE.villagerLevels['1'].workEfficiency);
  });
});

describe('soldiers', () => {
  it('only LV2 can enlist, and soldiers cannot do productive work', () => {
    const s = startAt();
    const v1 = s.villagers[0];
    expect(validateCommand(s, { type: 'setSoldier', player: 0, villager: v1.id, soldier: true })).toMatch(/LV1/);
    const v2 = lv2(s, 1);
    ok(s, { type: 'setSoldier', player: 0, villager: v2.id, soldier: true });
    expect(v2.soldier).toBe(true);
    const res = s.tiles.findIndex((t, i) => s.players[0].knowledge[i] === 1 && t.deposits.length > 0);
    expect(validateCommand(s, { type: 'gather', player: 0, villager: v2.id, tile: res })).toMatch(/士兵不能/);
    ok(s, { type: 'setSoldier', player: 0, villager: v2.id, soldier: false });
    expect(validateCommand(s, { type: 'gather', player: 0, villager: v2.id, tile: res })).toBeNull();
  });

  it('soldiers eat more in wartime, unless the war-economy policy is adopted', () => {
    const s = startAt();
    const p = s.players[0];
    const v = lv2(s);
    v.soldier = true;
    const peace = foodConsumptionPerMinute(s, p);
    p.atWar = true;
    const war = foodConsumptionPerMinute(s, p);
    const extra = BALANCE.villagerLevels['2'].foodPerMinute * (BALANCE.warSoldierFoodMultiplier - 1);
    expect(war - peace).toBeCloseTo(extra, 9);
    p.policies.push('warEconomy');
    expect(foodConsumptionPerMinute(s, p)).toBeCloseTo(peace, 9);
  });
});

describe('watchtower', () => {
  it('gives territory and vision only while garrisoned', () => {
    const s = startAt();
    exploreAll(s);
    const camp = s.players[0].startTile;
    const tile = s.tiles.findIndex(
      (t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, camp) === 3 && !s.buildings.some((b) => b.tile === i),
    );
    const before = s.tiles.filter((t) => t.owner === 0).length;
    const tower = addBuilding(s, 'watchtower', tile);
    run(s, 1);
    expect(s.tiles.filter((t) => t.owner === 0).length).toBe(before);

    const v = lv2(s);
    ok(s, { type: 'setSoldier', player: 0, villager: v.id, soldier: true });
    ok(s, { type: 'garrison', player: 0, villager: v.id, building: tower });
    run(s, 15);
    expect(v.tile).toBe(tile);
    const withTower = s.tiles.filter((t) => t.owner === 0).length;
    expect(withTower).toBeGreaterThan(before);
    expect(s.tiles[tile].owner).toBe(0);
    const far = s.tiles.findIndex((_, i) => hexDistance(s, i, tile) === BUILDINGS.watchtower.visionRadius);
    expect(s.players[0].visible[far]).toBe(1);

    ok(s, { type: 'move', player: 0, villager: v.id, tile: camp });
    run(s, 1);
    expect(s.tiles.filter((t) => t.owner === 0).length).toBe(before);
  });

  it('only accepts soldiers, up to its garrison slots', () => {
    const s = startAt();
    const tower = addBuilding(s, 'watchtower', freeTile(s));
    expect(validateCommand(s, { type: 'garrison', player: 0, villager: s.villagers[0].id, building: tower })).toBe(
      '只有士兵可以駐守',
    );
    for (let i = 0; i < 3; i++) {
      const v = lv2(s, i);
      v.soldier = true;
    }
    ok(s, { type: 'garrison', player: 0, villager: s.villagers[0].id, building: tower });
    ok(s, { type: 'garrison', player: 0, villager: s.villagers[1].id, building: tower });
    expect(validateCommand(s, { type: 'garrison', player: 0, villager: s.villagers[2].id, building: tower })).toMatch(/已滿/);
  });
});

describe('research', () => {
  it('researchers produce points that complete the chosen tech', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    s.players[0].stock.food = 1000;
    const lab = addBuilding(s, 'research', freeTile(s));
    const farmTile = freeTile(s, 0, (i) => TERRAIN[s.tiles[i].terrain].farmable);
    const farm = addBuilding(s, 'farm', farmTile);
    const rate0 = buildingRatePerWorker(s, s.buildings.find((b) => b.id === farm)!).food;
    ok(s, { type: 'setResearch', player: 0, research: 'agriculture' });
    ok(s, { type: 'work', player: 0, villager: s.villagers[0].id, building: lab });
    ok(s, { type: 'work', player: 0, villager: s.villagers[1].id, building: lab });
    run(s, 120);
    expect(s.players[0].researched).toContain('agriculture');
    expect(buildingRatePerWorker(s, s.buildings.find((b) => b.id === farm)!).food).toBeCloseTo(rate0 * 1.25, 9);
  });

  it('enforces prerequisites and mutually exclusive policies', () => {
    const s = startAt();
    expect(validateCommand(s, { type: 'setResearch', player: 0, research: 'irrigation' })).toMatch(/需要先研究/);
    s.players[0].policies.push('heavy');
    expect(validateCommand(s, { type: 'setResearch', player: 0, research: 'light' })).toMatch(/同類國策/);
    expect(validateCommand(s, { type: 'setResearch', player: 0, research: 'recuperate' })).toBeNull();
  });
});

describe('loyalty', () => {
  function sendFar(s: GameState) {
    const p = s.players[0];
    const v = s.villagers.find((x) => x.owner === 0)!;
    const target = s.tiles.findIndex(
      (t, i) =>
        TERRAIN[t.terrain].land &&
        hexDistance(s, i, p.startTile) >= 6 &&
        s.tiles.every((x, j) => x.owner === -1 || hexDistance(s, i, j) > BALANCE.loyalty.subvertRange),
    );
    v.tile = target;
    return v;
  }

  it('recovers inside territory and falls outside it', () => {
    const s = startAt();
    const v = sendFar(s);
    expect(isSupervised(s, v)).toBe(false);
    run(s, 20);
    expect(v.loyalty).toBeLessThan(BALANCE.loyalty.start);
  });

  it('unsupervised villagers eventually leave the nation', () => {
    const s = startAt();
    s.players[0].management.popEnabled = false;
    const v = sendFar(s);
    v.loyalty = 5;
    run(s, 600);
    expect(s.villagers.find((x) => x.id === v.id)).toBeUndefined();
  });

  it('can be subverted by a nearby foreign nation', () => {
    const s = startAt(undefined, 2);
    const enemy = s.players[1];
    const v = s.villagers.find((x) => x.owner === 0)!;
    // Stand just outside the enemy's territory.
    v.tile = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && t.owner === -1 && hexDistance(s, i, enemy.startTile) === 3);
    v.loyalty = 1;
    for (let i = 0; i < 6000 && v.owner === 0; i++) stepGame(s);
    expect(v.owner).toBe(1);
  });
});
