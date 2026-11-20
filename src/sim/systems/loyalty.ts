import { BALANCE } from '../data';
import { hexDistance } from '../hex';
import { getModifiers } from '../modifiers';
import { nextRandom } from '../rng';
import { getPlayer, logEvent, transferVillager } from '../state';
import type { GameState, Villager } from '../types';
import { buildingVisionRadius, isActive } from './territory';

/** A villager is supervised inside own territory or within an active watchtower's view. */
export function isSupervised(state: GameState, v: Villager): boolean {
  if (state.tiles[v.tile].owner === v.owner) return true;
  return state.buildings.some(
    (b) =>
      b.owner === v.owner &&
      b.type === 'watchtower' &&
      isActive(state, b) &&
      hexDistance(state, b.tile, v.tile) <= buildingVisionRadius(state, b),
  );
}

/** The nation that would subvert this villager: nearest foreign territory within range, if any. */
function subverter(state: GameState, v: Villager): number | null {
  let best: number | null = null;
  let bestDist = BALANCE.loyalty.subvertRange + 1;
  for (let i = 0; i < state.tiles.length; i++) {
    const owner = state.tiles[i].owner;
    if (owner === -1 || owner === v.owner) continue;
    const d = hexDistance(state, i, v.tile);
    if (d < bestDist || (d === bestDist && best !== null && owner < best)) {
      bestDist = d;
      best = owner;
    }
  }
  return best;
}

/** Runs once per second. */
export function runLoyalty(state: GameState): void {
  if (state.tick % BALANCE.ticksPerSecond !== 0) return;
  const cfg = BALANCE.loyalty;
  const lost: Villager[] = [];
  for (const v of state.villagers) {
    const mods = getModifiers(getPlayer(state, v.owner));
    if (v.resentment > 0) v.resentment = Math.max(0, v.resentment - BALANCE.conquest.resentmentDecayPerSecond);
    const cap = cfg.max - v.resentment;
    if (isSupervised(state, v) || (v.soldier && mods.soldierLoyaltyImmune > 0)) {
      v.loyalty = Math.min(cap, v.loyalty + cfg.recoverPerSecond);
    } else {
      v.loyalty = Math.max(0, v.loyalty - cfg.decayPerSecond * mods.loyaltyDecay);
    }
    v.loyalty = Math.min(v.loyalty, cap);
    if (v.loyalty >= cfg.threshold) continue;
    const chance = ((cfg.threshold - v.loyalty) / cfg.threshold) * cfg.defectChancePerSecond;
    if (nextRandom(state) < chance) lost.push(v);
  }

  for (const v of lost) {
    const from = getPlayer(state, v.owner);
    const to = subverter(state, v);
    const resist = getModifiers(from).subversionResist;
    if (to !== null && nextRandom(state) >= resist) {
      const target = getPlayer(state, to);
      logEvent(state, from.id, `村民 #${v.id} 被 ${target.name} 策反了！`);
      logEvent(state, to, `來自 ${from.name} 的村民 #${v.id} 投靠了我們`);
      transferVillager(state, v, to, { loyalty: cfg.afterDefection, resentment: v.resentment });
    } else if (to === null) {
      logEvent(state, from.id, `村民 #${v.id} 長期脫離管轄，獨立離開了國家`);
      state.villagers = state.villagers.filter((x) => x !== v);
    } else {
      // Subversion resisted: the villager comes back to its senses a little.
      v.loyalty = cfg.threshold;
    }
  }
}
