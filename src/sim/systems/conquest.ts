import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES } from '../data';
import { hexDistance } from '../hex';
import { getPlayer, logEvent } from '../state';
import { emptyStore, refreshStock } from '../storage';
import type { Building, GameState, PlayerId, TileIndex } from '../types';
import { isComplete } from './territory';

/** Capitals (camps) and branch cities anchor a "region" that is conquered as a whole. */
export function isSeat(b: Building): boolean {
  return b.type === 'camp' || b.type === 'city';
}

export function regionRadius(b: Building): number {
  return BUILDINGS[b.type].territoryRadius + BALANCE.conquest.regionExtraRadius;
}

/** The defender's capital/city whose region contains `tile` (nearest one, ties by id). */
export function seatOf(state: GameState, owner: PlayerId, tile: TileIndex): Building | undefined {
  return state.buildings
    .filter((b) => b.owner === owner && isSeat(b) && isComplete(b) && hexDistance(state, b.tile, tile) <= regionRadius(b))
    .sort((a, b) => hexDistance(state, a.tile, tile) - hexDistance(state, b.tile, tile) || a.id - b.id)[0];
}

/** Record war damage done to `owner` at `tile` (kills, building damage, destruction). */
export function addDevastation(state: GameState, owner: PlayerId, tile: TileIndex, amount: number): void {
  const seat = seatOf(state, owner, tile);
  if (seat) seat.devastation = (seat.devastation ?? 0) + amount;
}

/**
 * Move everything of `from` that satisfies `inRegion` to `to`: buildings (with
 * their stores), villagers (disarmed, resentful). Consulates are closed.
 */
function transfer(state: GameState, from: PlayerId, to: PlayerId, inRegion: (tile: TileIndex) => boolean, resentment: number) {
  const people = state.villagers.filter((v) => v.owner === from && inRegion(v.tile));
  const consulatesGone = state.buildings.filter((b) => b.owner === from && b.type === 'consulate' && inRegion(b.tile));
  state.buildings = state.buildings.filter((b) => !consulatesGone.includes(b));
  let buildings = 0;
  const goods = emptyStore();
  for (const b of state.buildings) {
    if (b.owner !== from || !inRegion(b.tile)) continue;
    b.owner = to;
    if (isSeat(b)) b.devastation = 0;
    if (b.store) for (const r of RESOURCE_TYPES) goods[r] += b.store[r];
    buildings++;
  }
  for (const v of people) {
    v.owner = to;
    v.soldier = false;
    v.naval = false;
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    v.resentment = resentment;
    v.loyalty = Math.min(v.loyalty, 100 - resentment);
  }
  refreshStock(state, getPlayer(state, from));
  refreshStock(state, getPlayer(state, to));
  state.mapVersion++;
  const taken = RESOURCE_TYPES.filter((r) => goods[r] >= 1).map((r) => `${RESOURCE_NAMES[r]} ${Math.floor(goods[r])}`);
  return { buildings, people: people.length, taken };
}

function mood(resentment: number): string {
  return resentment >= 50 ? '當地居民充滿怨恨' : resentment >= 20 ? '當地居民心存不滿' : '當地居民大致平靜';
}

/** The whole nation (everything left) goes to the conqueror. */
export function annexNation(state: GameState, from: PlayerId, to: PlayerId, resentment: number): void {
  const loser = getPlayer(state, from);
  const r = transfer(state, from, to, () => true, resentment);
  loser.capitalCrisis = null;
  logEvent(state, to, `收復${loser.name} 全境：${r.buildings} 棟建築、${r.people} 位居民${r.taken.length ? `，取得 ${r.taken.join('、')}` : ''}（${mood(resentment)}，怨恨 ${resentment}）`);
  logEvent(state, from, `${getPlayer(state, to).name} 吞併了我們的國家`);
}

/**
 * A capital or branch city was captured: its region passes to the conqueror
 * together with what its stores hold. If it was the loser's last capital and
 * they still have branch cities, they get to choose: surrender or rise again
 * (see crisis.ts); without branch cities the whole nation is annexed.
 * The more devastation, the more resentful the new subjects.
 */
export function annex(state: GameState, seat: Building, from: PlayerId, to: PlayerId): void {
  const loser = getPlayer(state, from);
  const winner = getPlayer(state, to);
  const cfg = BALANCE.conquest;
  const lastCapital =
    seat.type === 'camp' && !state.buildings.some((b) => b !== seat && b.owner === from && b.type === 'camp' && isComplete(b));
  const resentment = Math.min(cfg.maxResentment, Math.round(seat.devastation ?? 0));
  seat.devastation = 0;
  const hasCities = state.buildings.some((b) => b.owner === from && b.type === 'city' && isComplete(b));

  if (lastCapital && !hasCities) {
    annexNation(state, from, to, resentment);
    return;
  }
  const radius = regionRadius(seat);
  const r = transfer(state, from, to, (tile) => hexDistance(state, seat.tile, tile) <= radius, resentment);
  const what = seat.type === 'camp' ? `${loser.name} 的主城區域` : `${loser.name} 的分城區域`;
  logEvent(state, to, `收復${what}：${r.buildings} 棟建築、${r.people} 位居民${r.taken.length ? `，取得 ${r.taken.join('、')}` : ''}（${mood(resentment)}，怨恨 ${resentment}）`);
  logEvent(state, from, `${winner.name} 攻佔了我們的${seat.type === 'camp' ? '主城' : '分城'}，失去 ${r.buildings} 棟建築與 ${r.people} 位居民`);
  if (lastCapital) {
    loser.capitalCrisis = {
      by: to,
      deadline: state.tick + Math.round(BALANCE.capitalFall.decisionSeconds * BALANCE.ticksPerSecond),
      resentment,
    };
    logEvent(state, from, `👑 主城陷落！${BALANCE.capitalFall.decisionSeconds} 秒內決定：投降，或以人口最多的分城再起`);
    logEvent(state, to, `${loser.name} 的主城陷落，對方正在決定是否投降`);
  }
}
