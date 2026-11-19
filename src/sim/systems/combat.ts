import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES } from '../data';
import { getModifiers } from '../modifiers';
import { deposit } from '../storage';
import { neighbors } from '../hex';
import { buildingMaxHp, getPlayer, logEvent, unitMaxHp } from '../state';
import { isWater } from '../pathfinding';
import type { Building, GameState, PlayerId, Villager } from '../types';
import { atWarWith } from './diplomacy';
import { addDevastation, annex, isSeat } from './conquest';

const ROUGH = new Set(['forest', 'mud']);

/** Damage taken is divided by this. */
export function defenseMultiplier(state: GameState, v: Villager): number {
  const mods = getModifiers(getPlayer(state, v.owner));
  const c = BALANCE.combat;
  if (v.naval) return mods.navalDefense;
  let d = v.soldier ? mods.soldierDefense : 1;
  if (ROUGH.has(state.tiles[v.tile].terrain)) d *= 1 + c.roughTerrainDefense + (v.soldier ? mods.roughTerrainDefense : 0);
  if (v.order.kind === 'garrison' && v.path.length === 0) d *= 1 + c.garrisonDefense;
  return d;
}

/** Damage per second dealt by a villager. */
export function attackPerSecond(state: GameState, v: Villager): number {
  const c = BALANCE.combat;
  const body = BALANCE.villagerLevels[String(v.level)].workEfficiency;
  if (v.naval) return BALANCE.naval.navy.attack * body * getModifiers(getPlayer(state, v.owner)).navalAttack;
  if (!v.soldier) return c.civilianAttack * body;
  return c.soldierAttack * body * getModifiers(getPlayer(state, v.owner)).soldierAttack;
}

/** Enemies (at war with `owner`) on a tile: villagers first (soldiers before civilians), then buildings. */
export function enemiesOnTile(state: GameState, owner: PlayerId, tile: number) {
  const villagers = state.villagers
    .filter((x) => x.tile === tile && atWarWith(state, owner, x.owner))
    .sort((a, b) => Number(b.soldier) - Number(a.soldier) || a.id - b.id);
  const buildings = state.buildings.filter((b) => b.tile === tile && atWarWith(state, owner, b.owner)).sort((a, b) => a.id - b.id);
  return { villagers, buildings };
}

function plunder(state: GameState, b: Building, to: PlayerId) {
  const player = getPlayer(state, to);
  const share = BALANCE.combat.plunderShare * getModifiers(player).plunder;
  const cost = BUILDINGS[b.type].cost as Partial<Record<string, number>>;
  const got: string[] = [];
  for (const r of RESOURCE_TYPES) {
    const amount = Math.floor((cost[r] ?? 0) * share);
    if (amount > 0) {
      deposit(state, to, b.tile, r, amount);
      got.push(`${RESOURCE_NAMES[r]} ${amount}`);
    }
  }
  return got.join('、');
}

/** Auto-resolved combat between nations at war standing on the same tile. */
export function runCombat(state: GameState): void {
  state.combatTiles = [];
  const tps = BALANCE.ticksPerSecond;
  const byTile = new Map<number, Villager[]>();
  for (const v of state.villagers) {
    const list = byTile.get(v.tile);
    if (list) list.push(v);
    else byTile.set(v.tile, [v]);
  }

  const vDamage = new Map<Villager, { amount: number; by: PlayerId }>();
  const bDamage = new Map<Building, { amount: number; by: PlayerId }>();
  const fighting = new Set<number>();
  const hit = (v: Villager, tile: number, atk: number): boolean => {
    // Only navy can fight at sea: nobody else attacks from a ship or into the water.
    if (!v.naval && (isWater(state, v.tile) || isWater(state, tile))) return false;
    const { villagers, buildings } = enemiesOnTile(state, v.owner, tile);
    const target = villagers[0];
    if (target) {
      const prev = vDamage.get(target)?.amount ?? 0;
      vDamage.set(target, { amount: prev + atk / defenseMultiplier(state, target), by: v.owner });
    } else if (v.soldier && buildings[0]) {
      const b = buildings[0];
      const prev = bDamage.get(b)?.amount ?? 0;
      bDamage.set(b, { amount: prev + atk, by: v.owner });
    } else {
      return false;
    }
    fighting.add(tile);
    return true;
  };
  /** Our nation is involved in a fight on this tile (own unit or building there). */
  const ourBattle = (owner: PlayerId, tile: number) =>
    (byTile.get(tile) ?? []).some((x) => x.owner === owner) || state.buildings.some((b) => b.tile === tile && b.owner === owner);

  for (const [tile, vs] of byTile) {
    for (const v of vs) {
      const atk = attackPerSecond(state, v) / tps;
      if (hit(v, tile, atk)) continue;
      // Support: a stationary soldier with no enemy on its own tile helps a
      // battle our nation is fighting on one of the 6 adjacent tiles.
      if (!v.soldier || v.path.length > 0) continue;
      for (const n of neighbors(state, tile)) {
        if (ourBattle(v.owner, n) && hit(v, n, atk * BALANCE.combat.supportDamageMultiplier)) break;
      }
    }
  }
  state.combatTiles = [...fighting].sort((a, b) => a - b);

  const C = BALANCE.conquest;
  for (const [b, d] of bDamage) addDevastation(state, b.owner, b.tile, Math.min(d.amount, Math.max(0, b.hp)) * C.devastationPerBuildingHp);

  const dead = new Set<Villager>();
  for (const [v, d] of vDamage) {
    v.hp -= d.amount;
    if (v.hp <= 0) {
      dead.add(v);
      addDevastation(state, v.owner, v.tile, C.devastationPerKill);
      if (v.cargo) {
        // Intercepted: the goods belong to whoever killed the carrier.
        const got = deposit(state, d.by, v.tile, v.cargo.resource, v.cargo.amount);
        logEvent(state, d.by, `劫獲了 ${getPlayer(state, v.owner).name} 運送中的${RESOURCE_NAMES[v.cargo.resource]} ${Math.floor(got)}`);
        logEvent(state, v.owner, `運送中的${RESOURCE_NAMES[v.cargo.resource]} ${Math.floor(v.cargo.amount)} 被 ${getPlayer(state, d.by).name} 劫走了`);
        v.cargo = null;
      }
      const killer = getPlayer(state, d.by).name;
      logEvent(state, v.owner, `${v.soldier ? '士兵' : '村民'} #${v.id} 被 ${killer} 殺死了`);
      logEvent(state, d.by, `擊敗了 ${getPlayer(state, v.owner).name} 的${v.soldier ? '士兵' : '村民'} #${v.id}`);
    }
  }
  if (dead.size) state.villagers = state.villagers.filter((v) => !dead.has(v));

  const destroyed = new Set<Building>();
  let captured = false;
  for (const [b, d] of bDamage) {
    b.hp -= d.amount;
    if (b.hp > 0) continue;
    const def = BUILDINGS[b.type];
    const loser = getPlayer(state, b.owner).name;
    const winner = getPlayer(state, d.by).name;
    if (def.capturable && b.progress >= 1) {
      b.hp = buildingMaxHp(b) * BALANCE.combat.captureHpShare;
      delete b.host;
      captured = true;
      if (isSeat(b)) {
        // Taking a capital or branch city brings its whole region (or nation) along.
        annex(state, b, b.owner, d.by);
        continue;
      }
      // Occupation: the building (and the territory it gives) changes hands.
      logEvent(state, b.owner, `我們的${def.name}被 ${winner} 佔領了！`);
      logEvent(state, d.by, `佔領了 ${loser} 的${def.name}`);
      b.owner = d.by;
    } else {
      addDevastation(state, b.owner, b.tile, C.devastationPerDestroyedBuilding);
      destroyed.add(b);
      const loot = plunder(state, b, d.by);
      logEvent(state, b.owner, `我們的${def.name}被 ${winner} 摧毀了！`);
      logEvent(state, d.by, `摧毀了 ${loser} 的${def.name}${loot ? `，掠奪 ${loot}` : ''}`);
    }
  }
  if (destroyed.size) state.buildings = state.buildings.filter((b) => !destroyed.has(b));
  if (destroyed.size || captured) state.mapVersion++;

  // Wounded villagers recover slowly inside their own territory, away from fighting.
  if (state.tick % tps === 0) {
    const fighting = new Set(state.combatTiles);
    for (const v of state.villagers) {
      const max = unitMaxHp(v);
      if (v.hp < max && !fighting.has(v.tile) && state.tiles[v.tile].owner === v.owner) {
        v.hp = Math.min(max, v.hp + BALANCE.combat.regenPerSecond);
      }
    }
  }
}
