import { BALANCE, RESOURCE_TYPES } from '../data';
import { zeroRates, type Rates } from '../economy';
import { getModifiers } from '../modifiers';
import { getPlayer, logEvent, secondsToTicks } from '../state';
import type { GameState, PlayerId, Relation, RelationStatus } from '../types';
import { isComplete } from './territory';

export function makeRelations(playerCount: number): Relation[] {
  const out: Relation[] = [];
  for (let a = 0; a < playerCount; a++) {
    for (let b = a + 1; b < playerCount; b++) {
      out.push({ a, b, contact: false, status: 'none', proposal: null, deadline: 0, cooldownUntil: 0, since: 0 });
    }
  }
  return out;
}

export function getRelation(state: GameState, x: PlayerId, y: PlayerId): Relation {
  const [a, b] = x < y ? [x, y] : [y, x];
  const r = state.relations.find((rel) => rel.a === a && rel.b === b);
  if (!r) throw new Error(`No relation ${a}-${b}`);
  return r;
}

export function other(rel: Relation, me: PlayerId): PlayerId {
  return rel.a === me ? rel.b : rel.a;
}

export function relationsOf(state: GameState, me: PlayerId): Relation[] {
  return state.relations.filter((r) => r.a === me || r.b === me);
}

export function atWarWith(state: GameState, x: PlayerId, y: PlayerId): boolean {
  return x !== y && getRelation(state, x, y).status === 'war';
}

export const STATUS_NAMES: Record<RelationStatus, string> = {
  none: '無邦交',
  establishing: '建交中',
  allied: '正式邦交',
  war: '戰爭',
};

/** A finished consulate owned by `owner` inside `host`'s territory. */
export function consulateOf(state: GameState, owner: PlayerId, host: PlayerId) {
  return state.buildings.find((b) => b.type === 'consulate' && b.owner === owner && b.host === host);
}

export function hasConsulate(state: GameState, owner: PlayerId, host: PlayerId): boolean {
  const c = consulateOf(state, owner, host);
  return c !== undefined && isComplete(c);
}

export function alliedCount(state: GameState, me: PlayerId): number {
  return relationsOf(state, me).filter((r) => r.status === 'allied').length;
}

/** Passive trade income per minute from allied nations. */
export function tradePerMinute(state: GameState, me: PlayerId): Rates {
  const out = zeroRates();
  const n = alliedCount(state, me);
  if (n === 0) return out;
  const mult = getModifiers(getPlayer(state, me)).tradeIncome;
  for (const r of RESOURCE_TYPES) out[r] = BALANCE.diplomacy.tradePerMinute[r] * n * mult;
  return out;
}

function consulateDeadlineTicks(state: GameState, rel: Relation): number {
  const ma = getModifiers(getPlayer(state, rel.a)).consulateDeadline;
  const mb = getModifiers(getPlayer(state, rel.b)).consulateDeadline;
  return secondsToTicks(BALANCE.diplomacy.consulateDeadlineSeconds * Math.max(ma, mb));
}

function removeConsulates(state: GameState, rel: Relation) {
  const before = state.buildings.length;
  state.buildings = state.buildings.filter(
    (b) => !(b.type === 'consulate' && ((b.owner === rel.a && b.host === rel.b) || (b.owner === rel.b && b.host === rel.a))),
  );
  if (state.buildings.length !== before) state.mapVersion++;
}

export function setStatus(state: GameState, rel: Relation, status: RelationStatus): void {
  rel.status = status;
  rel.since = state.tick;
  rel.proposal = null;
  if (status === 'establishing') rel.deadline = state.tick + consulateDeadlineTicks(state, rel);
  if (status === 'none' || status === 'war') removeConsulates(state, rel);
  for (const p of state.players) p.atWar = relationsOf(state, p.id).some((r) => r.status === 'war');
}

/** Relations broke down: back to none with a cooldown. */
export function breakRelations(state: GameState, rel: Relation, reason: string): void {
  setStatus(state, rel, 'none');
  rel.cooldownUntil = state.tick + secondsToTicks(BALANCE.diplomacy.cooldownSeconds);
  const na = getPlayer(state, rel.a).name;
  const nb = getPlayer(state, rel.b).name;
  logEvent(state, rel.a, `與 ${nb} 的邦交破裂：${reason}`);
  logEvent(state, rel.b, `與 ${na} 的邦交破裂：${reason}`);
}

function seesPlayer(state: GameState, viewer: PlayerId, target: PlayerId): boolean {
  const vis = getPlayer(state, viewer).visible;
  for (let i = 0; i < state.tiles.length; i++) if (vis[i] && state.tiles[i].owner === target) return true;
  for (const v of state.villagers) if (v.owner === target && vis[v.tile]) return true;
  for (const b of state.buildings) if (b.owner === target && vis[b.tile]) return true;
  return false;
}

/** Runs once per second. */
export function runDiplomacy(state: GameState): void {
  if (state.tick % BALANCE.ticksPerSecond !== 0) return;
  for (const rel of state.relations) {
    const pa = getPlayer(state, rel.a);
    const pb = getPlayer(state, rel.b);
    if (pa.startTile === -1 || pb.startTile === -1 || pa.eliminated || pb.eliminated) continue;

    if (!rel.contact && (seesPlayer(state, rel.a, rel.b) || seesPlayer(state, rel.b, rel.a))) {
      rel.contact = true;
      logEvent(state, rel.a, `與 ${pb.name} 接觸了`);
      logEvent(state, rel.b, `與 ${pa.name} 接觸了`);
    }

    if (rel.proposal && state.tick >= rel.proposal.expires) {
      const kind = rel.proposal.kind === 'relations' ? '建交' : '和平';
      logEvent(state, rel.proposal.from, `${getPlayer(state, other(rel, rel.proposal.from)).name} 沒有回應${kind}提議`);
      rel.proposal = null;
    }

    const both = hasConsulate(state, rel.a, rel.b) && hasConsulate(state, rel.b, rel.a);
    if (rel.status === 'establishing') {
      if (both) {
        setStatus(state, rel, 'allied');
        logEvent(state, rel.a, `與 ${pb.name} 互設領事館，建立正式邦交`);
        logEvent(state, rel.b, `與 ${pa.name} 互設領事館，建立正式邦交`);
      } else if (state.tick >= rel.deadline) {
        breakRelations(state, rel, '期限內沒有互設領事館');
      }
    } else if (rel.status === 'allied' && !both) {
      setStatus(state, rel, 'establishing');
      logEvent(state, rel.a, `與 ${pb.name} 的領事館遭到破壞，需要在期限內重建`);
      logEvent(state, rel.b, `與 ${pa.name} 的領事館遭到破壞，需要在期限內重建`);
    }
  }

  // Trade income, once per second.
  for (const p of state.players) {
    const t = tradePerMinute(state, p.id);
    for (const r of RESOURCE_TYPES) p.stock[r] += t[r] / 60;
  }
}
