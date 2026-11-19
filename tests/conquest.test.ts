import { describe, expect, it } from 'vitest';
import { BALANCE, BUILDINGS, TERRAIN } from '../src/sim/data';
import { validateCommand } from '../src/sim/commands';
import { stepGame } from '../src/sim/game';
import { hexDistance } from '../src/sim/hex';
import { getRelation, setStatus } from '../src/sim/systems/diplomacy';
import { annex, addDevastation } from '../src/sim/systems/conquest';
import { workEfficiency } from '../src/sim/economy';
import { refreshStock } from '../src/sim/storage';
import { newVillager } from '../src/sim/state';
import { addBuilding, run, startAt, setStock } from './helpers';
import type { GameState, Villager } from '../src/sim/types';

function twoNations(): GameState {
  const s = startAt(undefined, 2);
  for (const p of s.players) {
    p.ai = null;
    p.management.popEnabled = false;
    setStock(s, p.id, { food: 1000, wood: 400, stone: 200, ore: 0 });
  }
  getRelation(s, 0, 1).contact = true;
  setStatus(s, getRelation(s, 0, 1), 'war');
  return s;
}

function soldier(s: GameState, owner: number, tile: number): Villager {
  const v = newVillager(s, owner, tile);
  v.level = 2;
  v.hp = BALANCE.combat.hp['2'];
  v.soldier = true;
  return v;
}

const capital = (s: GameState, owner: number) => s.buildings.find((b) => b.owner === owner && b.type === 'camp')!;

describe('conquering capitals and branch cities', () => {
  it('taking the last capital annexes the whole nation: land, buildings, people and resources', () => {
    const s = twoNations();
    const enemyCamp = capital(s, 1);
    const farm = addBuilding(s, 'farm', s.tiles.findIndex((t, i) => t.owner === 1 && i !== enemyCamp.tile && TERRAIN[t.terrain].land), 1);
    const enemyPeople = s.villagers.filter((v) => v.owner === 1).length;
    const myWood = s.players[0].stock.wood;
    annex(s, enemyCamp, 1, 0);
    expect(s.buildings.filter((b) => b.owner === 1)).toHaveLength(0);
    expect(s.buildings.find((b) => b.id === farm)!.owner).toBe(0);
    expect(s.villagers.filter((v) => v.owner === 0).length).toBe(BALANCE.startingVillagers + enemyPeople);
    expect(s.players[0].stock.wood).toBe(myWood + 400);
    expect(s.players[1].stock.wood).toBe(0);
    run(s, 2);
    expect(s.players[1].eliminated).toBe(true);
  });

  it('taking a branch city annexes only its region, including what its store holds', () => {
    const s = twoNations();
    const enemyStart = s.players[1].startTile;
    const cityTile = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && t.owner === -1 && hexDistance(s, i, enemyStart) === 8);
    const cityId = addBuilding(s, 'city', cityTile, 1);
    const city = s.buildings.find((b) => b.id === cityId)!;
    city.store!.wood = 120;
    refreshStock(s, s.players[1]);
    const local = newVillager(s, 1, cityTile);
    const theirs = s.players[1].stock.wood;
    const mine = s.players[0].stock.wood;
    annex(s, city, 1, 0);
    expect(city.owner).toBe(0);
    expect(local.owner).toBe(0);
    expect(capital(s, 1).owner).toBe(1); // their capital (and its store) is untouched
    expect(s.players[1].stock.wood).toBe(theirs - 120);
    expect(s.players[0].stock.wood).toBe(mine + 120);
  });

  it('the more devastation, the more resentful (and less loyal) the conquered people', () => {
    const resentmentAfter = (devastation: number) => {
      const s = twoNations();
      const camp = capital(s, 1);
      addDevastation(s, 1, camp.tile, devastation);
      const people = s.villagers.filter((v) => v.owner === 1);
      annex(s, camp, 1, 0);
      return people[0];
    };
    const calm = resentmentAfter(0);
    const angry = resentmentAfter(60);
    expect(calm.resentment).toBe(0);
    expect(angry.resentment).toBe(60);
    expect(angry.loyalty).toBeLessThanOrEqual(40);
  });

  it('resentment caps loyalty, fades slowly and lowers work efficiency', () => {
    const s = twoNations();
    const v = s.villagers.find((x) => x.owner === 0)!;
    const full = workEfficiency(s, v);
    v.resentment = 50;
    v.loyalty = 50;
    run(s, 10);
    expect(v.loyalty).toBeLessThanOrEqual(100 - v.resentment);
    expect(v.resentment).toBeCloseTo(50 - 10 * BALANCE.conquest.resentmentDecayPerSecond, 6);
    expect(workEfficiency(s, v)).toBeLessThan(full);
  });

  it('war damage in a region is recorded on its city, and storming the capital in battle annexes it', () => {
    const s = twoNations();
    const camp = capital(s, 1);
    camp.hp = 50;
    // Two defenders on the camp; one villager elsewhere keeps the nation alive.
    const defenders = s.villagers.filter((v) => v.owner === 1);
    for (const d of defenders.slice(0, 2)) d.tile = camp.tile;
    const elsewhere = defenders[2];
    elsewhere.tile = s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && t.owner === -1 && hexDistance(s, i, camp.tile) > 6);
    const army = [0, 1, 2, 3, 4].map(() => soldier(s, 0, camp.tile));
    run(s, 40);
    // Defenders on the tile were killed first (devastation), then the camp fell and the rest was annexed.
    expect(camp.owner).toBe(0);
    expect(army.some((a) => s.villagers.includes(a))).toBe(true);
    // Last capital: the whole nation, including the villager far away, now belongs to us — resentful.
    expect(elsewhere.owner).toBe(0);
    expect(elsewhere.resentment).toBeGreaterThanOrEqual(2 * BALANCE.conquest.devastationPerKill - 1);
    expect(s.events.some((e) => e.player === 0 && e.message.includes('收復'))).toBe(true);
    expect(BUILDINGS.camp.capturable).toBe(true);
  });
});

describe('capital falls: surrender or rise again', () => {
  function setup() {
    const s = twoNations();
    const camp = capital(s, 1);
    const enemyStart = s.players[1].startTile;
    // Two branch cities: a big one and a small one.
    const tiles = s.tiles
      .map((_, i) => i)
      .filter((i) => TERRAIN[s.tiles[i].terrain].land && s.tiles[i].owner === -1 && hexDistance(s, i, enemyStart) >= 7 && hexDistance(s, i, enemyStart) <= 9);
    const bigTile = tiles[0];
    const smallTile = tiles.find((t) => hexDistance(s, t, bigTile) >= 6)!;
    const bigId = addBuilding(s, 'city', bigTile, 1);
    addBuilding(s, 'city', smallTile, 1);
    const big = s.buildings.find((b) => b.id === bigId)!;
    const townsfolk = [newVillager(s, 1, bigTile), newVillager(s, 1, bigTile), newVillager(s, 1, bigTile)];
    newVillager(s, 1, smallTile);
    // A wanderer far from every city.
    const wanderer = newVillager(s, 1, s.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && t.owner === -1 && hexDistance(s, i, enemyStart) > 12 && hexDistance(s, i, bigTile) > 4 && hexDistance(s, i, smallTile) > 4));
    run(s, 1);
    return { s, camp, big, townsfolk, wanderer };
  }

  it('losing the last capital with branch cities left starts a 30-second decision instead of annexing everything', () => {
    const { s, camp, big } = setup();
    annex(s, camp, 1, 0);
    expect(camp.owner).toBe(0);
    expect(big.owner).toBe(1);
    expect(s.players[1].capitalCrisis).toMatchObject({ by: 0 });
    expect(s.players[1].capitalCrisis!.deadline - s.tick).toBe(BALANCE.capitalFall.decisionSeconds * BALANCE.ticksPerSecond);
    run(s, 2);
    expect(s.players[1].eliminated).toBe(false);
  });

  it('surrender: the whole nation is annexed', () => {
    const { s, camp, big } = setup();
    annex(s, camp, 1, 0);
    expect(validateCommand(s, { type: 'capitalDecision', player: 1, choice: 'surrender' })).toBeNull();
    stepGame(s, [{ type: 'capitalDecision', player: 1, choice: 'surrender' }]);
    expect(big.owner).toBe(0);
    run(s, 2);
    expect(s.players[1].eliminated).toBe(true);
  });

  it('rise again: the most populous city becomes a half-strength capital; people outside city land are lost', () => {
    const { s, camp, big, townsfolk, wanderer } = setup();
    annex(s, camp, 1, 0);
    stepGame(s, [{ type: 'capitalDecision', player: 1, choice: 'rise' }]);
    expect(big.type).toBe('camp');
    expect(big.owner).toBe(1);
    expect(big.maxHp).toBe(BUILDINGS.camp.hp * BALANCE.capitalFall.riseHpShare);
    expect(big.hp).toBe(big.maxHp);
    expect(s.players[1].capitalCrisis).toBeNull();
    expect(townsfolk.every((v) => v.owner === 1)).toBe(true);
    expect(wanderer.owner).toBe(0);
    run(s, 2);
    expect(s.players[1].eliminated).toBe(false);
  });

  it('if nobody decides in time, the default choice is applied', () => {
    const { s, camp, big } = setup();
    annex(s, camp, 1, 0);
    run(s, BALANCE.capitalFall.decisionSeconds + 1);
    expect(s.players[1].capitalCrisis).toBeNull();
    if (BALANCE.capitalFall.defaultChoice === 'rise') expect(big.type).toBe('camp');
    else expect(big.owner).toBe(0);
  });

  it('decisions are only possible during a crisis', () => {
    const s = twoNations();
    expect(validateCommand(s, { type: 'capitalDecision', player: 1, choice: 'rise' })).toBe('主城沒有陷落');
  });
});
