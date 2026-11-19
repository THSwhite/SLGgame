import { describe, expect, it } from 'vitest';
import { GameController } from '../src/client/controller';
import { exploreWithNearestIdle, quickOrder, withNearestIdle } from '../src/client/orders';
import { canExploreTile, validateCommand } from '../src/sim/commands';
import { TERRAIN } from '../src/sim/data';
import { hexDistance } from '../src/sim/hex';
import { TEST_MAP_SEED } from '../src/sim/game';
import { solidLand, hasFarmland } from './helpers';

function started() {
  const c = new GameController({ seed: TEST_MAP_SEED, aiCount: 0 });
  const s = c.state;
  const start = s.tiles.findIndex((_, i) => solidLand(s, i) && hasFarmland(s, i));
  c.issue({ type: 'chooseStart', player: 0, tile: start });
  c.state.players[0].management.popEnabled = false;
  return c;
}

describe('explore a tile with the nearest idle unit', () => {
  it('sends the nearest idle villager', () => {
    const c = started();
    const s = c.state;
    const start = s.players[0].startTile;
    const target = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && s.players[0].knowledge[i] === 0 && hexDistance(s, i, start) === 3);
    expect(target).toBeGreaterThanOrEqual(0);
    // Put one villager closer to the target than the others.
    const closer = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, target) === 1 && hexDistance(s, i, start) <= 2);
    expect(closer).toBeGreaterThanOrEqual(0);
    const near = s.villagers[2];
    near.tile = closer;
    expect(exploreWithNearestIdle(c, target)).toBeNull();
    expect(c.selection.villager).toBe(near.id);
    c.update(200);
    expect(near.order.kind).toBe('explore');
    expect(s.villagers.filter((v) => v.order.kind === 'explore')).toHaveLength(1);
  });

  it('reports when nobody is idle', () => {
    const c = started();
    const s = c.state;
    for (const v of s.villagers) v.order = { kind: 'move', target: v.tile };
    const target = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && s.players[0].knowledge[i] === 0);
    expect(exploreWithNearestIdle(c, target)).toBe('無空閒單位可用');
    expect(c.lastError).toBe('無空閒單位可用');
  });
});

describe('no exploring from afar', () => {
  it('only tiles next to explored land (or next to our units) can be explored', () => {
    const c = started();
    const s = c.state;
    const start = s.players[0].startTile;
    const frontier = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && s.players[0].knowledge[i] === 0 && hexDistance(s, i, start) === 3);
    const far = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && s.players[0].knowledge[i] === 0 && hexDistance(s, i, start) === 6);
    const v = s.villagers[0];
    expect(validateCommand(s, { type: 'explore', player: 0, villager: v.id, tile: frontier })).toBeNull();
    expect(validateCommand(s, { type: 'explore', player: 0, villager: v.id, tile: far })).toBe('只能探索已知地塊周圍的地塊');
    // A unit standing next to it makes it explorable (e.g. after landing on a new shore).
    const beside = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, far) === 1);
    s.villagers[1].tile = beside;
    expect(canExploreTile(s, 0, far)).toBe(true);
  });
});

describe('other quick orders without a selection', () => {
  it('right-click logic sends the nearest idle civilian to gather or to work', () => {
    const c = started();
    const s = c.state;
    const deposit = s.tiles.findIndex((t, i) => s.players[0].knowledge[i] === 1 && t.deposits.length > 0 && !s.buildings.some((b) => b.tile === i));
    expect(quickOrder(c, deposit)).toBeNull();
    c.update(200);
    expect(s.villagers.some((v) => v.order.kind === 'gather')).toBe(true);
    // A soldier is never sent to gather.
    for (const v of s.villagers) {
      if (v.order.kind === 'idle') {
        v.level = 2;
        v.soldier = true;
      }
    }
    expect(withNearestIdle(c, deposit, (v) => ({ type: 'gather', player: 0, villager: v.id, tile: deposit }), { civiliansOnly: true })).toBe(
      '無空閒單位可用',
    );
  });
});
