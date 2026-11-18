import { BALANCE, RESOURCE_NAMES } from '../data';
import { moveCost } from '../pathfinding';
import { getPlayer, logEvent } from '../state';
import { Knowledge, type GameState, type Villager } from '../types';
import { isStarving } from './food';

export function workEfficiency(state: GameState, v: Villager): number {
  const level = BALANCE.villagerLevels[String(v.level)];
  const starving = isStarving(getPlayer(state, v.owner));
  return level.workEfficiency * (starving ? BALANCE.starvingWorkEfficiency : 1);
}

function describeDeposits(state: GameState, tile: number): string {
  const ds = state.tiles[tile].deposits;
  if (ds.length === 0) return '沒有可採集的資源';
  return '發現 ' + ds.map((d) => `${RESOURCE_NAMES[d.resource]} ${d.amount}`).join('、');
}

function stepVillager(state: GameState, v: Villager): void {
  const eff = workEfficiency(state, v);
  const tps = BALANCE.ticksPerSecond;

  if (v.path.length > 0) {
    const next = v.path[0];
    v.moveProgress += eff / (BALANCE.moveSecondsPerTile * tps * moveCost(state, next));
    if (v.moveProgress >= 1) {
      v.tile = next;
      v.path.shift();
      v.moveProgress = 0;
    }
    return;
  }

  const order = v.order;
  switch (order.kind) {
    case 'idle':
      return;
    case 'move':
      v.order = { kind: 'idle' };
      return;
    case 'explore': {
      const player = getPlayer(state, v.owner);
      if (player.knowledge[order.target] === Knowledge.Explored) {
        v.order = { kind: 'idle' };
        return;
      }
      order.progress += eff / (BALANCE.exploreSeconds * tps);
      if (order.progress >= 1) {
        player.knowledge[order.target] = Knowledge.Explored;
        state.mapVersion++;
        logEvent(state, v.owner, `村民 #${v.id} 探索完成：${describeDeposits(state, order.target)}`);
        v.order = { kind: 'idle' };
      }
      return;
    }
    case 'gather': {
      const tile = state.tiles[order.target];
      const deposit = tile.deposits.find((d) => d.resource === order.resource);
      if (!deposit || deposit.amount <= 0) {
        v.order = { kind: 'idle' };
        return;
      }
      const amount = Math.min(deposit.amount, (BALANCE.gatherPerSecond[order.resource] * eff) / tps);
      deposit.amount -= amount;
      getPlayer(state, v.owner).stock[order.resource] += amount;
      if (deposit.amount <= 1e-9) {
        tile.deposits = tile.deposits.filter((d) => d !== deposit);
        state.mapVersion++;
        logEvent(state, v.owner, `村民 #${v.id}：此地的${RESOURCE_NAMES[order.resource]}已採集完畢`);
        v.order = { kind: 'idle' };
      }
      return;
    }
  }
}

export function runJobs(state: GameState): void {
  for (const v of state.villagers) stepVillager(state, v);
}
