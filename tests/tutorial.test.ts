import { describe, expect, it } from 'vitest';
import { createTutorialController } from '../src/client/tutorial';
import type { GameController } from '../src/client/controller';
import { BUILDINGS, TERRAIN, type BuildingType } from '../src/sim/data';
import { hexDistance } from '../src/sim/hex';
import { canExploreTile, validateCommand, type Command } from '../src/sim/commands';
import { capitalOf } from '../src/sim/storage';

/** Advance the game (1 tick per call) and let the tutorial check its step. */
function play(c: GameController, seconds: number, until?: () => boolean) {
  for (let i = 0; i < seconds * 10; i++) {
    c.update(100);
    c.tutorial!.update();
    if (until?.()) return;
  }
}

function issue(c: GameController, cmd: Command) {
  const err = c.issue(cmd);
  expect(err, JSON.stringify(cmd)).toBeNull();
  play(c, 0.2);
}

/** An idle civilian; if everyone is busy, stop someone who is gathering or working. */
function idleVillager(c: GameController) {
  const mine = c.state.villagers.filter((x) => x.owner === 0 && !x.soldier);
  let v = mine.find((x) => x.order.kind === 'idle' && x.path.length === 0);
  if (!v) {
    v = mine.find((x) => x.order.kind === 'gather' || x.order.kind === 'work');
    expect(v).toBeDefined();
    c.issue({ type: 'stop', player: 0, villager: v!.id });
    play(c, 0.2);
  }
  return v!;
}

function build(c: GameController, type: BuildingType, pred: (i: number) => boolean = () => true) {
  const s = c.state;
  const v = idleVillager(c);
  const start = s.players[0].startTile;
  const tiles = s.tiles.map((_, i) => i).sort((a, b) => hexDistance(s, a, start) - hexDistance(s, b, start) || a - b);
  const tile = tiles.find((i) => pred(i) && validateCommand(s, { type: 'placeBuilding', player: 0, villager: v.id, tile: i, building: type }) === null);
  expect(tile, type).toBeDefined();
  issue(c, { type: 'placeBuilding', player: 0, villager: v.id, tile: tile!, building: type });
  const b = s.buildings.find((x) => x.type === type && x.tile === tile)!;
  play(c, 120, () => b.progress >= 1);
  expect(b.progress).toBe(1);
  return b;
}

describe('tutorial', () => {
  it('uses the same fixed map and starts every time', () => {
    const a = createTutorialController();
    const b = createTutorialController();
    expect(a.state.seed).toBe(b.state.seed);
    expect(a.state.players.map((p) => p.startTile)).toEqual(b.state.players.map((p) => p.startTile));
    expect(a.tutorial!.steps.map((x) => x.title)).toEqual([
      '如何採集',
      '村民控制',
      '建造建築',
      '發展科技',
      '拓展國土',
      '探索未知地',
      '遇到他國',
      '如何外交',
      '訓練士兵',
      '如何宣戰',
      '戰勝敵國',
    ]);
  });

  it('can be played through from start to victory', () => {
    const c = createTutorialController();
    const s = c.state;
    const t = c.tutorial!;
    s.players[0].management.popEnabled = false;
    const at = (title: string) => expect(t.step?.title).toBe(title);
    const waitNext = () => play(c, 5, () => t.completedAt === null);

    at('如何採集');
    const wood = s.tiles.findIndex((x, i) => s.players[0].knowledge[i] === 1 && x.deposits.some((d) => d.resource === 'wood'));
    issue(c, { type: 'gather', player: 0, villager: idleVillager(c).id, tile: wood });
    play(c, 3);
    at('村民控制');
    const v1 = idleVillager(c);
    const spot = s.tiles.findIndex((x, i) => x.owner === 0 && TERRAIN[x.terrain].land && i !== v1.tile);
    issue(c, { type: 'move', player: 0, villager: v1.id, tile: spot });
    play(c, 3);

    at('建造建築');
    build(c, 'farm', (i) => TERRAIN[s.tiles[i].terrain].farmable);
    play(c, 3);

    at('發展科技');
    build(c, 'research'); // the builder stays on as a researcher
    issue(c, { type: 'setResearch', player: 0, research: 'agriculture' });
    play(c, 3);

    at('拓展國土');
    build(c, 'house', (i) => hexDistance(s, i, s.players[0].startTile) >= 2);
    play(c, 3);

    at('探索未知地');
    const unknown = s.tiles.findIndex((x, i) => TERRAIN[x.terrain].land && s.players[0].knowledge[i] === 0 && canExploreTile(s, 0, i));
    issue(c, { type: 'explore', player: 0, villager: idleVillager(c).id, tile: unknown });
    play(c, 3);

    at('遇到他國');
    const scout = idleVillager(c);
    issue(c, { type: 'move', player: 0, villager: scout.id, tile: s.tiles.findIndex((x, i) => TERRAIN[x.terrain].land && hexDistance(s, i, t.neighbourTile) === 3) });
    play(c, 120, () => t.step?.title !== '遇到他國');

    at('如何外交');
    issue(c, { type: 'diplomacy', player: 0, target: 1, action: 'proposeRelations' });
    play(c, 5, () => t.step?.title !== '如何外交');

    at('訓練士兵');
    const barracks = build(c, 'barracks');
    const recruits = s.villagers.filter((x) => x.owner === 0 && !x.soldier).slice(0, 2);
    for (const r of recruits) issue(c, { type: 'stop', player: 0, villager: r.id });
    for (const r of recruits) issue(c, { type: 'train', player: 0, villager: r.id, building: barracks.id });
    play(c, 150, () => recruits.every((r) => r.level >= 2));
    for (const r of recruits) issue(c, { type: 'setSoldier', player: 0, villager: r.id, soldier: true });
    play(c, 3);

    at('如何宣戰');
    issue(c, { type: 'diplomacy', player: 0, target: 1, action: 'declareWar' });
    play(c, 3);

    at('戰勝敵國');
    const enemyCamp = capitalOf(s, 1)!;
    expect(enemyCamp.hp).toBeLessThanOrEqual(BUILDINGS.camp.hp / 3);
    for (const r of recruits) issue(c, { type: 'attack', player: 0, villager: r.id, tile: enemyCamp.tile });
    play(c, 300, () => t.finished || s.phase === 'ended');
    expect(s.players[1].eliminated).toBe(true);
    expect(s.result?.winner).toBe(0);
    waitNext();
  }, 120000);
});
