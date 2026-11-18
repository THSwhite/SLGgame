import { describe, expect, it } from 'vitest';
import { createGame, stepGame, TEST_MAP_SEED } from '../src/sim/game';
import { BALANCE, TERRAIN } from '../src/sim/data';
import { hexDistance } from '../src/sim/hex';
import { MIN_START_DISTANCE, validateCommand, type Command } from '../src/sim/commands';
import { getRelation, tradePerMinute } from '../src/sim/systems/diplomacy';
import { exploreAll, ok, run, solidLand, hasFarmland } from './helpers';
import type { GameState } from '../src/sim/types';

/** Human player 0 plus `ais` AI nations; the human starts at the first good tile. */
function withAI(ais = 1): GameState {
  const s = createGame({
    seed: TEST_MAP_SEED,
    players: [
      { name: '玩家', color: '#e53935', isAI: false },
      ...Array.from({ length: ais }, (_, i) => ({ name: `AI${i + 1}`, color: ['#1e88e5', '#43a047', '#fdd835'][i], isAI: true })),
    ],
  });
  const start = s.tiles.findIndex((_, i) => solidLand(s, i) && hasFarmland(s, i));
  stepGame(s, [{ type: 'chooseStart', player: 0, tile: start }]);
  return s;
}

function diplo(s: GameState, player: number, target: number, action: Extract<Command, { type: 'diplomacy' }>['action']) {
  ok(s, { type: 'diplomacy', player, target, action });
}

/** Disable AI thinking so diplomacy tests are fully scripted. */
function scripted(s: GameState) {
  for (const p of s.players) p.ai = null;
}

describe('AI nations', () => {
  it('pick their own starts far from the human once the human chooses', () => {
    const s = withAI(2);
    expect(s.phase).toBe('playing');
    const starts = s.players.map((p) => p.startTile);
    expect(starts.every((t) => t >= 0 && TERRAIN[s.tiles[t].terrain].land)).toBe(true);
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) expect(hexDistance(s, starts[i], starts[j])).toBeGreaterThanOrEqual(MIN_START_DISTANCE);
    }
    expect(s.villagers.filter((v) => v.owner === 1)).toHaveLength(BALANCE.startingVillagers);
  });

  it('develop their economy on their own', () => {
    const s = withAI(1);
    s.players[0].management.popEnabled = false;
    run(s, 600);
    const ai = s.players[1];
    const pop = s.villagers.filter((v) => v.owner === 1).length;
    const types = new Set(s.buildings.filter((b) => b.owner === 1 && b.progress >= 1).map((b) => b.type));
    expect(pop).toBeGreaterThan(BALANCE.startingVillagers);
    expect(types.has('farm')).toBe(true);
    expect(ai.knowledge.filter((k) => k === 1).length).toBeGreaterThan(19);
  });

  it('are deterministic', () => {
    const play = () => {
      const s = withAI(2);
      run(s, 120);
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });
});

describe('diplomacy', () => {
  it('requires contact before any diplomacy', () => {
    const s = withAI(1);
    scripted(s);
    expect(validateCommand(s, { type: 'diplomacy', player: 0, target: 1, action: 'proposeRelations' })).toBe('尚未與對方接觸');
    expect(validateCommand(s, { type: 'diplomacy', player: 0, target: 1, action: 'declareWar' })).toBe('尚未與對方接觸');
  });

  it('breaks relations when consulates are not built in time, then enforces a cooldown', () => {
    const s = withAI(1);
    scripted(s);
    const rel = getRelation(s, 0, 1);
    rel.contact = true;
    diplo(s, 0, 1, 'proposeRelations');
    expect(validateCommand(s, { type: 'diplomacy', player: 0, target: 1, action: 'accept' })).toBe('對方沒有提出提議');
    diplo(s, 1, 0, 'accept');
    expect(rel.status).toBe('establishing');
    run(s, BALANCE.diplomacy.consulateDeadlineSeconds + 2);
    expect(rel.status).toBe('none');
    expect(validateCommand(s, { type: 'diplomacy', player: 0, target: 1, action: 'proposeRelations' })).toMatch(/冷卻期/);
    run(s, BALANCE.diplomacy.cooldownSeconds);
    expect(validateCommand(s, { type: 'diplomacy', player: 0, target: 1, action: 'proposeRelations' })).toBeNull();
  });

  it('becomes allied once both consulates exist, which brings trade', () => {
    const s = withAI(1);
    scripted(s);
    exploreAll(s, 0);
    exploreAll(s, 1);
    for (const p of s.players) {
      p.stock.wood = 500;
      p.stock.stone = 500;
      p.stock.food = 1000;
      p.management.popEnabled = false;
    }
    const rel = getRelation(s, 0, 1);
    rel.contact = true;
    diplo(s, 1, 0, 'proposeRelations');
    diplo(s, 0, 1, 'accept');

    // A consulate must stand in the partner's territory.
    const myLand = s.tiles.findIndex((t, i) => t.owner === 0 && !s.buildings.some((b) => b.tile === i));
    const v0 = s.villagers.find((v) => v.owner === 0)!;
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: v0.id, tile: myLand, building: 'consulate' })).toMatch(
      /建交對象的國土/,
    );
    const inP1 = s.tiles.findIndex((t, i) => t.owner === 1 && !s.buildings.some((b) => b.tile === i));
    const inP0 = s.tiles.findIndex((t, i) => t.owner === 0 && !s.buildings.some((b) => b.tile === i));
    const v1 = s.villagers.find((v) => v.owner === 1)!;
    ok(s, { type: 'placeBuilding', player: 0, villager: v0.id, tile: inP1, building: 'consulate' });
    ok(s, { type: 'placeBuilding', player: 1, villager: v1.id, tile: inP0, building: 'consulate' });
    const inP1b = s.tiles.findIndex((t, i) => t.owner === 1 && !s.buildings.some((b) => b.tile === i));
    expect(validateCommand(s, { type: 'placeBuilding', player: 0, villager: s.villagers[1].id, tile: inP1b, building: 'consulate' })).toMatch(
      /已經在/,
    );
    // Long walk plus construction, within the deadline.
    for (let i = 0; i < BALANCE.diplomacy.consulateDeadlineSeconds * BALANCE.ticksPerSecond && rel.status !== 'allied'; i++) stepGame(s);
    expect(rel.status).toBe('allied');
    expect(tradePerMinute(s, 0).food).toBeGreaterThan(0);
    const wood = s.players[0].stock.wood;
    run(s, 60);
    expect(s.players[0].stock.wood - wood).toBeCloseTo(BALANCE.diplomacy.tradePerMinute.wood, 0);
  });

  it('war: declaring removes consulates, peace must be agreed', () => {
    const s = withAI(1);
    scripted(s);
    const rel = getRelation(s, 0, 1);
    rel.contact = true;
    diplo(s, 0, 1, 'proposeRelations');
    diplo(s, 1, 0, 'accept');
    const inP1 = s.tiles.findIndex((t) => t.owner === 1);
    s.buildings.push({ id: 999, type: 'consulate', owner: 0, tile: inP1, progress: 1, host: 1 });
    diplo(s, 1, 0, 'declareWar');
    expect(rel.status).toBe('war');
    expect(s.players[0].atWar && s.players[1].atWar).toBe(true);
    expect(s.buildings.some((b) => b.id === 999)).toBe(false);
    diplo(s, 0, 1, 'proposePeace');
    diplo(s, 1, 0, 'reject');
    expect(rel.status).toBe('war');
    diplo(s, 0, 1, 'proposePeace');
    diplo(s, 1, 0, 'accept');
    expect(rel.status).toBe('none');
    expect(s.players[0].atWar).toBe(false);
  });

  it('AI answers a human proposal', () => {
    const s = withAI(1);
    s.players[1].ai!.openness = 0.9;
    s.players[1].ai!.aggression = 0.1;
    const rel = getRelation(s, 0, 1);
    rel.contact = true;
    diplo(s, 0, 1, 'proposeRelations');
    run(s, BALANCE.ai.thinkEverySeconds + 1);
    expect(rel.status).toBe('establishing');
  });
});
