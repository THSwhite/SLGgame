import { afterEach, describe, expect, it } from 'vitest';
import { stepGame, createGame } from '../src/sim/game';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { hexDistance } from '../src/sim/hex';
import { validateCommand } from '../src/sim/commands';
import { getRelation, setStatus } from '../src/sim/systems/diplomacy';
import { defenseMultiplier } from '../src/sim/systems/combat';
import { newVillager } from '../src/sim/state';
import { addBuilding, exploreAll, ok, run, startAt } from './helpers';
import type { GameState, Villager } from '../src/sim/types';

function twoNations(): GameState {
  const s = startAt(undefined, 2);
  for (const p of s.players) {
    p.ai = null;
    p.management.popEnabled = false;
    p.stock.food = 5000;
  }
  getRelation(s, 0, 1).contact = true;
  return s;
}

function war(s: GameState) {
  setStatus(s, getRelation(s, 0, 1), 'war');
}

function soldier(s: GameState, owner: number, tile: number): Villager {
  const v = newVillager(s, owner, tile);
  v.level = 2;
  v.hp = BALANCE.combat.hp['2'];
  v.soldier = true;
  return v;
}

/** A plain (non-rough) land tile outside everyone's territory. */
function neutralTile(s: GameState, rough = false): number {
  return s.tiles.findIndex(
    (t, i) =>
      TERRAIN[t.terrain].land &&
      t.owner === -1 &&
      (rough ? t.terrain === 'forest' : t.terrain === 'grass') &&
      !s.buildings.some((b) => b.tile === i) &&
      !s.villagers.some((v) => v.tile === i),
  );
}

const saved = { ...BALANCE.victory };
afterEach(() => Object.assign(BALANCE.victory, saved));

describe('combat', () => {
  it('does not happen between nations that are not at war', () => {
    const s = twoNations();
    const t = neutralTile(s);
    const a = soldier(s, 0, t);
    const b = soldier(s, 1, t);
    run(s, 10);
    expect(a.hp).toBe(BALANCE.combat.hp['2']);
    expect(b.hp).toBe(BALANCE.combat.hp['2']);
  });

  it('soldiers kill enemy civilians at war', () => {
    const s = twoNations();
    war(s);
    const t = neutralTile(s);
    soldier(s, 0, t);
    const civ = newVillager(s, 1, t);
    run(s, 30);
    expect(s.villagers.includes(civ)).toBe(false);
    expect(s.events.some((e) => e.player === 1 && e.message.includes('殺死'))).toBe(true);
  });

  it('two equal soldiers fight; forest gives the defender an edge', () => {
    const s = twoNations();
    war(s);
    const t = neutralTile(s, true);
    const a = soldier(s, 0, t);
    const b = soldier(s, 1, t);
    expect(defenseMultiplier(s, a)).toBeGreaterThan(1);
    run(s, 5);
    expect(a.hp).toBeLessThan(BALANCE.combat.hp['2']);
    expect(a.hp).toBeCloseTo(b.hp, 6);
  });

  it('soldiers destroy enemy buildings and plunder them', () => {
    const s = twoNations();
    war(s);
    const t = s.tiles.findIndex((tile, i) => tile.owner === 1 && !s.buildings.some((b) => b.tile === i) && TERRAIN[tile.terrain].land);
    const house = addBuilding(s, 'house', t, 1);
    s.buildings.find((b) => b.id === house)!.hp = BUILDINGS.house.hp;
    for (let i = 0; i < 3; i++) soldier(s, 0, t);
    const wood = s.players[0].stock.wood;
    run(s, 30);
    expect(s.buildings.some((b) => b.id === house)).toBe(false);
    expect(s.players[0].stock.wood - wood).toBe(Math.floor(BUILDINGS.house.cost.wood! * BALANCE.combat.plunderShare));
  });

  it('attacking requires a declaration of war', () => {
    const s = twoNations();
    const v = soldier(s, 0, s.players[0].startTile);
    const enemyCamp = s.players[1].startTile;
    expect(validateCommand(s, { type: 'attack', player: 0, villager: v.id, tile: enemyCamp })).toMatch(/宣戰/);
    expect(validateCommand(s, { type: 'attack', player: 0, villager: s.villagers[0].id, tile: enemyCamp })).toMatch(/只有士兵/);
    war(s);
    ok(s, { type: 'attack', player: 0, villager: v.id, tile: enemyCamp });
    expect(v.order.kind).toBe('attack');
  });

  it('wounded villagers heal inside their own territory', () => {
    const s = twoNations();
    const v = s.villagers[0];
    v.hp = 10;
    run(s, 10);
    expect(v.hp).toBeGreaterThan(10);
  });
});

describe('elimination and victory', () => {
  it('a nation without people is eliminated; the last one standing wins by conquest', () => {
    const s = twoNations();
    s.villagers = s.villagers.filter((v) => v.owner !== 1);
    run(s, 2);
    expect(s.players[1].eliminated).toBe(true);
    expect(s.buildings.some((b) => b.owner === 1)).toBe(false);
    expect(s.result).toMatchObject({ winner: 0, reason: 'conquest' });
    expect(s.phase).toBe('ended');
    const tick = s.tick;
    stepGame(s);
    expect(s.tick).toBe(tick);
  });

  it('losing all territory buildings eliminates a nation', () => {
    const s = twoNations();
    s.buildings = s.buildings.filter((b) => b.owner !== 1);
    run(s, 2);
    expect(s.players[1].eliminated).toBe(true);
  });

  it('the human losing means defeat', () => {
    const s = twoNations();
    s.players[1].isAI = true;
    s.villagers = s.villagers.filter((v) => v.owner !== 0);
    run(s, 2);
    expect(s.result?.reason).toBe('defeat');
  });

  it('controlling enough land wins', () => {
    const s = twoNations();
    BALANCE.victory.territoryShare = 0.01;
    run(s, 2);
    expect(s.result?.reason).toBe('territory');
  });

  it('when time runs out the strongest nation wins', () => {
    const s = twoNations();
    for (let i = 0; i < 5; i++) newVillager(s, 1, s.players[1].startTile);
    s.tick = BALANCE.victory.timeLimitMinutes * 60 * BALANCE.ticksPerSecond - 5;
    run(s, 2);
    expect(s.result).toMatchObject({ winner: 1, reason: 'time' });
  });
});

describe('AI at war', () => {
  it('sends its army against known enemy buildings', () => {
    const s = createGame({
      seed: 20261118,
      players: [
        { name: '玩家', color: '#e53935', isAI: false },
        { name: 'AI', color: '#1e88e5', isAI: true },
      ],
    });
    const start = s.tiles.findIndex((t) => t.terrain === 'grass');
    stepGame(s, [{ type: 'chooseStart', player: 0, tile: start }]);
    s.players[0].management.popEnabled = false;
    exploreAll(s, 1);
    getRelation(s, 0, 1).contact = true;
    war(s);
    const army = Array.from({ length: 4 }, () => soldier(s, 1, s.players[1].startTile));
    run(s, BALANCE.ai.thinkEverySeconds + 1);
    expect(army.some((v) => v.order.kind === 'attack')).toBe(true);
    const target = (army.find((v) => v.order.kind === 'attack')!.order as { target: number }).target;
    expect(hexDistance(s, target, s.players[0].startTile)).toBeLessThanOrEqual(3);
  });
});

describe('support from adjacent tiles', () => {
  function setup(withAlly: boolean) {
    const s = twoNations();
    war(s);
    const battle = neutralTile(s);
    const side = s.tiles.findIndex(
      (t, i) => TERRAIN[t.terrain].land && t.terrain !== 'forest' && t.terrain !== 'mud' && hexDistance(s, i, battle) === 1,
    );
    const enemy = soldier(s, 1, battle);
    const supporter = soldier(s, 0, side);
    if (withAlly) newVillager(s, 0, battle); // a civilian of ours is in the fight
    return { s, enemy, supporter };
  }

  it('a soldier next to a battle we are in deals reduced damage there, without being hit', () => {
    const { s, enemy, supporter } = setup(true);
    const before = enemy.hp;
    stepGame(s);
    const civ = BALANCE.combat.civilianAttack * BALANCE.villagerLevels['1'].workEfficiency;
    const sup = BALANCE.combat.soldierAttack * BALANCE.villagerLevels['2'].workEfficiency * BALANCE.combat.supportDamageMultiplier;
    expect(before - enemy.hp).toBeCloseTo((civ + sup) / BALANCE.ticksPerSecond, 6);
    expect(supporter.hp).toBe(BALANCE.combat.hp['2']);
  });

  it('does not attack across tiles when we are not part of that battle', () => {
    const { s, enemy } = setup(false);
    const before = enemy.hp;
    run(s, 2);
    expect(enemy.hp).toBe(before);
  });
});
