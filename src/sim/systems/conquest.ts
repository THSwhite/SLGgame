import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES } from '../data';
import { hexDistance } from '../hex';
import { getPlayer, logEvent } from '../state';
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
 * A capital or branch city was captured: its region (or, for the last capital,
 * the whole nation) passes to the conqueror together with a share of the
 * loser's resources. The more devastation, the more resentful the new subjects.
 */
export function annex(state: GameState, seat: Building, from: PlayerId, to: PlayerId): void {
  const loser = getPlayer(state, from);
  const winner = getPlayer(state, to);
  const cfg = BALANCE.conquest;
  const lastCapital =
    seat.type === 'camp' && !state.buildings.some((b) => b !== seat && b.owner === from && b.type === 'camp' && isComplete(b));
  const radius = regionRadius(seat);
  const inRegion = (tile: TileIndex) => lastCapital || hexDistance(state, seat.tile, tile) <= radius;

  const people = state.villagers.filter((v) => v.owner === from && inRegion(v.tile));
  const total = state.villagers.filter((v) => v.owner === from).length;
  const share = lastCapital
    ? 1
    : seat.type === 'camp'
      ? cfg.capitalStockShare
      : Math.max(cfg.branchStockShareMin, total ? people.length / total : 0);

  const resentment = Math.min(cfg.maxResentment, Math.round(seat.devastation ?? 0));
  seat.devastation = 0;

  // Buildings: consulates of the loser are closed, everything else changes hands.
  const consulatesGone = state.buildings.filter((b) => b.owner === from && b.type === 'consulate' && inRegion(b.tile));
  state.buildings = state.buildings.filter((b) => !consulatesGone.includes(b));
  let buildings = 0;
  for (const b of state.buildings) {
    if (b.owner !== from || !inRegion(b.tile)) continue;
    b.owner = to;
    if (isSeat(b)) b.devastation = 0;
    buildings++;
  }

  for (const v of people) {
    v.owner = to;
    v.soldier = false;
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    v.resentment = resentment;
    v.loyalty = Math.min(v.loyalty, 100 - resentment);
  }

  const taken: string[] = [];
  for (const r of RESOURCE_TYPES) {
    const amount = Math.floor(loser.stock[r] * share);
    if (amount <= 0) continue;
    loser.stock[r] -= amount;
    winner.stock[r] += amount;
    taken.push(`${RESOURCE_NAMES[r]} ${amount}`);
  }
  state.mapVersion++;

  const what = lastCapital ? `${loser.name} 全境` : seat.type === 'camp' ? `${loser.name} 的主城區域` : `${loser.name} 的分城區域`;
  const mood = resentment >= 50 ? '當地居民充滿怨恨' : resentment >= 20 ? '當地居民心存不滿' : '當地居民大致平靜';
  logEvent(
    state,
    to,
    `收復${what}：${buildings} 棟建築、${people.length} 位居民${taken.length ? `，取得 ${taken.join('、')}` : ''}（${mood}，怨恨 ${resentment}）`,
  );
  logEvent(state, from, `${winner.name} 攻佔了我們的${seat.type === 'camp' ? '主城' : '分城'}，失去 ${buildings} 棟建築與 ${people.length} 位居民`);
}
