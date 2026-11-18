import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES } from '../data';
import { buildingRatePerWorker, gatherRate, researchRatePerWorker, workEfficiency, workersAt } from '../economy';
import { getModifiers } from '../modifiers';
import { moveCost } from '../pathfinding';
import { getPlayer, logEvent } from '../state';
import { Knowledge, type Building, type GameState, type Villager } from '../types';
import { isComplete, recomputeTerritory } from './territory';

export { workEfficiency };

function describeDeposits(state: GameState, tile: number): string {
  const ds = state.tiles[tile].deposits;
  if (ds.length === 0) return '沒有可採集的資源';
  return '發現 ' + ds.map((d) => `${RESOURCE_NAMES[d.resource]} ${d.amount}`).join('、');
}

function findBuilding(state: GameState, id: number): Building | undefined {
  return state.buildings.find((b) => b.id === id);
}

function completeBuilding(state: GameState, b: Building): void {
  b.progress = 1;
  const def = BUILDINGS[b.type];
  if (def.territoryRadius > 0) recomputeTerritory(state);
  state.mapVersion++;
  logEvent(state, b.owner, `${def.name}建造完成`);
  // Builders move straight on to working there, while there are free slots.
  const builders = state.villagers
    .filter((v) => v.order.kind === 'construct' && v.order.building === b.id)
    .sort((a, c) => a.id - c.id);
  for (const v of builders) {
    if (def.workerSlots > workersAt(state, b.id).length) v.order = { kind: 'work', building: b.id };
    else v.order = { kind: 'idle' };
  }
}

function stepVillager(state: GameState, v: Villager): void {
  const eff = workEfficiency(state, v);
  const tps = BALANCE.ticksPerSecond;

  if (v.path.length > 0) {
    const next = v.path[0];
    const speed = v.soldier ? getModifiers(getPlayer(state, v.owner)).soldierSpeed : 1;
    v.moveProgress += (eff * speed) / (BALANCE.moveSecondsPerTile * tps * moveCost(state, next));
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
      const amount = Math.min(deposit.amount, (gatherRate(getPlayer(state, v.owner), order.resource) * eff) / tps);
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
    case 'construct': {
      const b = findBuilding(state, order.building);
      if (!b || isComplete(b)) {
        v.order = b && BUILDINGS[b.type].workerSlots > workersAt(state, b.id).length ? { kind: 'work', building: b.id } : { kind: 'idle' };
        return;
      }
      const speed = getModifiers(getPlayer(state, v.owner)).buildSpeed;
      b.progress += (eff * speed) / (BUILDINGS[b.type].buildSeconds * tps);
      if (b.progress >= 1) completeBuilding(state, b);
      return;
    }
    case 'work': {
      const b = findBuilding(state, order.building);
      if (!b || !isComplete(b)) {
        v.order = { kind: 'idle' };
        return;
      }
      const rates = buildingRatePerWorker(state, b);
      const player = getPlayer(state, v.owner);
      player.researchPoints += (researchRatePerWorker(state, b) * eff) / tps;
      const tile = state.tiles[b.tile];
      for (const r of RESOURCE_TYPES) {
        let amount = (rates[r] * eff) / tps;
        if (amount <= 0) continue;
        if (r === 'ore') {
          // Ore comes out of the tile's finite deposit.
          const d = tile.deposits.find((x) => x.resource === 'ore');
          if (!d) continue;
          amount = Math.min(amount, d.amount);
          d.amount -= amount;
          if (d.amount <= 1e-9) {
            tile.deposits = tile.deposits.filter((x) => x !== d);
            state.mapVersion++;
            logEvent(state, v.owner, `礦場的礦脈已經枯竭`);
          }
        }
        player.stock[r] += amount;
      }
      return;
    }
    case 'train': {
      const b = findBuilding(state, order.building);
      if (!b || !isComplete(b) || v.level >= BALANCE.training.maxLevel) {
        v.order = { kind: 'idle' };
        return;
      }
      const player = getPlayer(state, v.owner);
      if (!order.paid) {
        // Wait at the barracks until the food for training is available.
        if (player.stock.food < BALANCE.training.foodCost) return;
        player.stock.food -= BALANCE.training.foodCost;
        order.paid = true;
      }
      // Training improves the body, so it is not slowed by the trainee's own efficiency.
      order.progress += getModifiers(player).trainSpeed / (BALANCE.training.seconds * tps);
      if (order.progress >= 1) {
        v.level++;
        v.order = { kind: 'idle' };
        logEvent(state, v.owner, `村民 #${v.id} 訓練完成，升到 LV${v.level}（可以從軍）`);
      }
      return;
    }
    case 'garrison': {
      const b = findBuilding(state, order.building);
      if (!b || !isComplete(b) || b.owner !== v.owner || !v.soldier) v.order = { kind: 'idle' };
      return;
    }
  }
}

export function runJobs(state: GameState): void {
  for (const v of state.villagers) stepVillager(state, v);
}
