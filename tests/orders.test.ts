import { describe, expect, it } from 'vitest';
import { GameController } from '../src/client/controller';
import { exploreWithNearestIdle } from '../src/client/orders';
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
    const target = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && s.players[0].knowledge[i] === 0 && hexDistance(s, i, start) === 4);
    expect(target).toBeGreaterThanOrEqual(0);
    // Put one villager closer to the target than the others.
    const closer = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hexDistance(s, i, target) === 2 && hexDistance(s, i, start) <= 2);
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
