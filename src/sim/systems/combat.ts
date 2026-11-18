import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES } from '../data';
import { getModifiers } from '../modifiers';
import { getPlayer, logEvent, maxVillagerHp } from '../state';
import type { Building, GameState, PlayerId, Villager } from '../types';
import { atWarWith } from './diplomacy';

const ROUGH = new Set(['forest', 'mud']);

/** Damage taken is divided by this. */
export function defenseMultiplier(state: GameState, v: Villager): number {
  const mods = getModifiers(getPlayer(state, v.owner));
  const c = BALANCE.combat;
  let d = v.soldier ? mods.soldierDefense : 1;
  if (ROUGH.has(state.tiles[v.tile].terrain)) d *= 1 + c.roughTerrainDefense + (v.soldier ? mods.roughTerrainDefense : 0);
  if (v.order.kind === 'garrison' && v.path.length === 0) d *= 1 + c.garrisonDefense;
  return d;
}

/** Damage per second dealt by a villager. */
export function attackPerSecond(state: GameState, v: Villager): number {
  const c = BALANCE.combat;
  const body = BALANCE.villagerLevels[String(v.level)].workEfficiency;
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
      player.stock[r] += amount;
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
  for (const [tile, vs] of byTile) {
    let fought = false;
    for (const v of vs) {
      const { villagers, buildings } = enemiesOnTile(state, v.owner, tile);
      const atk = attackPerSecond(state, v) / tps;
      const target = villagers[0];
      if (target) {
        const prev = vDamage.get(target)?.amount ?? 0;
        vDamage.set(target, { amount: prev + atk / defenseMultiplier(state, target), by: v.owner });
        fought = true;
      } else if (v.soldier && buildings[0]) {
        const b = buildings[0];
        const prev = bDamage.get(b)?.amount ?? 0;
        bDamage.set(b, { amount: prev + atk, by: v.owner });
        fought = true;
      }
    }
    if (fought) state.combatTiles.push(tile);
  }

  const dead = new Set<Villager>();
  for (const [v, d] of vDamage) {
    v.hp -= d.amount;
    if (v.hp <= 0) {
      dead.add(v);
      const killer = getPlayer(state, d.by).name;
      logEvent(state, v.owner, `${v.soldier ? '士兵' : '村民'} #${v.id} 被 ${killer} 殺死了`);
      logEvent(state, d.by, `擊敗了 ${getPlayer(state, v.owner).name} 的${v.soldier ? '士兵' : '村民'} #${v.id}`);
    }
  }
  if (dead.size) state.villagers = state.villagers.filter((v) => !dead.has(v));

  const destroyed = new Set<Building>();
  for (const [b, d] of bDamage) {
    b.hp -= d.amount;
    if (b.hp <= 0) {
      destroyed.add(b);
      const name = BUILDINGS[b.type].name;
      const loot = plunder(state, b, d.by);
      logEvent(state, b.owner, `我們的${name}被 ${getPlayer(state, d.by).name} 摧毀了！`);
      logEvent(state, d.by, `摧毀了 ${getPlayer(state, b.owner).name} 的${name}${loot ? `，掠奪 ${loot}` : ''}`);
    }
  }
  if (destroyed.size) {
    state.buildings = state.buildings.filter((b) => !destroyed.has(b));
    state.mapVersion++;
  }

  // Wounded villagers recover slowly inside their own territory, away from fighting.
  if (state.tick % tps === 0) {
    const fighting = new Set(state.combatTiles);
    for (const v of state.villagers) {
      const max = maxVillagerHp(v.level);
      if (v.hp < max && !fighting.has(v.tile) && state.tiles[v.tile].owner === v.owner) {
        v.hp = Math.min(max, v.hp + BALANCE.combat.regenPerSecond);
      }
    }
  }
}
