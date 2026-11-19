import { BALANCE, BUILDINGS } from '../data';
import { hexDistance } from '../hex';
import { getPlayer, logEvent } from '../state';
import type { Building, GameState, Player, PlayerId } from '../types';
import { annexNation, regionRadius } from './conquest';
import { isComplete, recomputeTerritory } from './territory';
import { refreshStock } from '../storage';

export type CrisisChoice = 'surrender' | 'rise';

/** The branch city that would become the new capital: the most populous one (ties: lower id). */
export function riseCandidate(state: GameState, player: Player): Building | undefined {
  const cities = state.buildings.filter((b) => b.owner === player.id && b.type === 'city' && isComplete(b));
  const pop = (c: Building) =>
    state.villagers.filter((v) => v.owner === player.id && hexDistance(state, v.tile, c.tile) <= regionRadius(c)).length;
  return cities.sort((a, b) => pop(b) - pop(a) || a.id - b.id)[0];
}

/** Villagers that stay when rising again: those inside the land of a remaining capital/branch city. */
export function keepsVillager(state: GameState, owner: PlayerId, tile: number): boolean {
  return state.buildings.some(
    (b) => b.owner === owner && (b.type === 'city' || b.type === 'camp') && isComplete(b) && hexDistance(state, b.tile, tile) <= BUILDINGS[b.type].territoryRadius,
  );
}

export function resolveCrisis(state: GameState, player: Player, choice: CrisisChoice): void {
  const crisis = player.capitalCrisis;
  if (!crisis) return;
  const conqueror = crisis.by;
  const city = riseCandidate(state, player);
  if (choice === 'surrender' || !city) {
    logEvent(state, player.id, `向 ${getPlayer(state, conqueror).name} 投降`);
    annexNation(state, player.id, conqueror, crisis.resentment);
    return;
  }
  // Rise again: the most populous branch city becomes the capital, at reduced strength.
  city.type = 'camp';
  city.maxHp = BUILDINGS.camp.hp * BALANCE.capitalFall.riseHpShare;
  city.hp = city.maxHp;
  city.devastation = 0;
  player.capitalCrisis = null;
  player.management.spawnAt = null;
  // Everyone outside the remaining cities' land is lost to the conqueror.
  let lost = 0;
  for (const v of state.villagers) {
    if (v.owner !== player.id || keepsVillager(state, player.id, v.tile)) continue;
    v.owner = conqueror;
    v.soldier = false;
    v.naval = false;
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    v.cargo = null;
    v.resentment = crisis.resentment;
    v.loyalty = Math.min(v.loyalty, 100 - crisis.resentment);
    lost++;
  }
  recomputeTerritory(state);
  refreshStock(state, player);
  refreshStock(state, getPlayer(state, conqueror));
  logEvent(state, player.id, `👑 以分城再起，設立新主城（生命上限減半）；失去 ${lost} 位不在分城領地內的人口`);
  logEvent(state, conqueror, `${player.name} 拒絕投降，以分城再起；${lost} 位居民歸順我們`);
}

/** Once per second: crises whose time ran out are decided by default. */
export function runCrisis(state: GameState): void {
  if (state.tick % BALANCE.ticksPerSecond !== 0) return;
  for (const p of state.players) {
    if (p.capitalCrisis && state.tick >= p.capitalCrisis.deadline) resolveCrisis(state, p, BALANCE.capitalFall.defaultChoice);
  }
}
