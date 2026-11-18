import { findPolicy, TECHS } from '../data';
import { logEvent } from '../state';
import type { GameState, Player } from '../types';

export function researchCost(id: string): number {
  return TECHS[id]?.cost ?? findPolicy(id)?.def.cost ?? Infinity;
}

export function researchName(id: string): string {
  return TECHS[id]?.name ?? findPolicy(id)?.def.name ?? id;
}

/** Why a tech/policy cannot be researched now (zh-Hant), or null. */
export function researchBlocked(player: Player, id: string): string | null {
  const tech = TECHS[id];
  if (tech) {
    if (player.researched.includes(id)) return '已經研究完成';
    const missing = tech.requires.filter((r) => !player.researched.includes(r));
    if (missing.length) return `需要先研究：${missing.map((m) => TECHS[m].name).join('、')}`;
    return null;
  }
  const policy = findPolicy(id);
  if (!policy) return '未知的研究項目';
  if (player.policies.includes(id)) return '已經採用';
  const taken = player.policies.find((p) => findPolicy(p)?.group === policy.group);
  if (taken) return `已經採用同類國策「${researchName(taken)}」`;
  return null;
}

export function runResearch(state: GameState): void {
  for (const player of state.players) {
    const id = player.currentResearch;
    if (!id) continue;
    if (researchBlocked(player, id)) {
      player.currentResearch = null;
      continue;
    }
    const cost = researchCost(id);
    if (player.researchPoints < cost) continue;
    player.researchPoints -= cost;
    if (TECHS[id]) player.researched.push(id);
    else player.policies.push(id);
    player.currentResearch = null;
    logEvent(state, player.id, `研究完成：${researchName(id)}`);
  }
}
