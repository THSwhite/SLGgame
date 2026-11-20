import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES } from '../data';
import { buildingRatePerWorker, gatherRate, researchRatePerWorker, workEfficiency, workersAt } from '../economy';
import { getModifiers } from '../modifiers';
import { deposit as depositGoods, depositTarget, refreshStock, storeSpace, transportFactor, withdraw } from '../storage';
import { findPath, pathOpts } from '../pathfinding';
import { canAfford } from '../economy';
import { moveCost } from '../pathfinding';
import { getPlayer, logEvent, maxVillagerHp } from '../state';
import { Knowledge, type Building, type GameState, type Villager } from '../types';
import { isComplete, recomputeTerritory } from './territory';
import { enemiesOnTile } from './combat';
import { lacksWorkforce } from './cities';

export { workEfficiency };

function describeDeposits(state: GameState, tile: number): string {
  const ds = state.tiles[tile].deposits;
  if (ds.length === 0) return '沒有可採集的資源';
  return '發現 ' + ds.map((d) => `${RESOURCE_NAMES[d.resource]} ${d.amount}`).join('、');
}

function findBuilding(state: GameState, id: number, owner?: number): Building | undefined {
  // A building that was captured is no longer ours to work in.
  return state.buildings.find((b) => b.id === id && (owner === undefined || b.owner === owner));
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
    v.moveProgress += 1 / (moveSecondsPerTile(state, v) * tps * moveCost(state, next));
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
      // Goods go to the nearest store with room; the farther it is, the slower they arrive.
      const target = depositTarget(state, v.owner, v.tile, order.resource);
      if (!target) return; // every store is full: wait
      const rate = gatherRate(getPlayer(state, v.owner), order.resource) * eff * transportFactor(target.distance);
      const amount = Math.min(deposit.amount, rate / tps);
      deposit.amount -= amount;
      depositGoods(state, v.owner, v.tile, order.resource, amount);
      if (deposit.amount <= 1e-9) {
        tile.deposits = tile.deposits.filter((d) => d !== deposit);
        state.mapVersion++;
        logEvent(state, v.owner, `村民 #${v.id}：此地的${RESOURCE_NAMES[order.resource]}已採集完畢`);
        v.order = { kind: 'idle' };
      }
      return;
    }
    case 'construct': {
      const b = findBuilding(state, order.building, v.owner);
      if (!b || isComplete(b)) {
        v.order = b && BUILDINGS[b.type].workerSlots > workersAt(state, b.id).length ? { kind: 'work', building: b.id } : { kind: 'idle' };
        return;
      }
      // Materials must arrive from the stores first.
      if ((b.delivery ?? 0) > 0) return;
      // Some buildings (branch cities) need a crowd on site before work can start.
      if (lacksWorkforce(state, b)) return;
      const speed = getModifiers(getPlayer(state, v.owner)).buildSpeed;
      b.progress += (eff * speed) / (BUILDINGS[b.type].buildSeconds * tps);
      if (b.progress >= 1) completeBuilding(state, b);
      return;
    }
    case 'work': {
      const b = findBuilding(state, order.building, v.owner);
      if (!b || !isComplete(b)) {
        v.order = { kind: 'idle' };
        return;
      }
      const rates = buildingRatePerWorker(state, b);
      const player = getPlayer(state, v.owner);
      player.researchPoints += (researchRatePerWorker(state, b) * eff) / tps;
      const tile = state.tiles[b.tile];
      for (const r of RESOURCE_TYPES) {
        if (rates[r] <= 0) continue;
        const target = depositTarget(state, v.owner, b.tile, r);
        if (!target) continue; // storage full
        let amount = (rates[r] * eff * transportFactor(target.distance)) / tps;
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
        depositGoods(state, v.owner, b.tile, r, amount);
      }
      return;
    }
    case 'train': {
      const b = findBuilding(state, order.building, v.owner);
      if (!b || !isComplete(b) || (!order.navy && v.level >= BALANCE.training.maxLevel)) {
        v.order = { kind: 'idle' };
        return;
      }
      const player = getPlayer(state, v.owner);
      if (order.navy) {
        // Shipbuilding at a harbor: pay for the ship, then train the crew.
        const navy = BALANCE.naval.navy;
        if (!order.paid) {
          if (!canAfford(player, navy.cost)) return;
          withdraw(state, v.owner, b.tile, navy.cost);
          order.paid = true;
        }
        order.progress += getModifiers(player).trainSpeed / (navy.trainSeconds * tps);
        if (order.progress >= 1) {
          v.naval = true;
          v.hp = navy.hp;
          v.order = { kind: 'idle' };
          logEvent(state, v.owner, `士兵 #${v.id} 成為海軍，可以在海上作戰`);
        }
        return;
      }
      if (!order.paid) {
        // Wait at the barracks until the food for training is available.
        if (player.stock.food < BALANCE.training.foodCost) return;
        withdraw(state, v.owner, b.tile, { food: BALANCE.training.foodCost });
        order.paid = true;
      }
      // Training improves the body, so it is not slowed by the trainee's own efficiency.
      order.progress += getModifiers(player).trainSpeed / (BALANCE.training.seconds * tps);
      if (order.progress >= 1) {
        v.level++;
        v.hp = maxVillagerHp(v.level);
        v.order = { kind: 'idle' };
        logEvent(state, v.owner, `村民 #${v.id} 訓練完成，升到 LV${v.level}（可以從軍）`);
      }
      return;
    }
    case 'transport': {
      const from = findBuilding(state, order.from, v.owner);
      const to = findBuilding(state, order.to, v.owner);
      if (order.stage === 'pickup') {
        if (!from?.store || !to) {
          v.order = { kind: 'idle' };
          return;
        }
        const amount = Math.min(order.amount, from.store[order.resource]);
        if (amount <= 0) {
          v.order = { kind: 'idle' };
          return;
        }
        from.store[order.resource] -= amount;
        refreshStock(state, getPlayer(state, v.owner));
        v.cargo = { resource: order.resource, amount };
        order.stage = 'deliver';
        v.path = findPath(state, v.tile, to.tile, pathOpts(v)) ?? [];
        return;
      }
      // Delivering: unload into the destination (overflow / lost destination: nearest other store).
      if (v.cargo) {
        let left = v.cargo.amount;
        if (to?.store && to.tile === v.tile) {
          const put = Math.min(left, storeSpace(to, v.cargo.resource));
          to.store[v.cargo.resource] += put;
          left -= put;
        }
        if (left > 0) depositGoods(state, v.owner, v.tile, v.cargo.resource, left);
        refreshStock(state, getPlayer(state, v.owner));
        logEvent(state, v.owner, `村民 #${v.id} 運送了 ${RESOURCE_NAMES[v.cargo.resource]} ${Math.floor(v.cargo.amount)}`);
        v.cargo = null;
      }
      v.order = { kind: 'idle' };
      return;
    }
    case 'attack': {
      // Stay and fight while there is an enemy here; afterwards stand by.
      const { villagers, buildings } = enemiesOnTile(state, v.owner, v.tile);
      if (villagers.length === 0 && buildings.length === 0) v.order = { kind: 'idle' };
      return;
    }
    case 'garrison': {
      const b = findBuilding(state, order.building);
      if (!b || !isComplete(b) || b.owner !== v.owner || !v.soldier) v.order = { kind: 'idle' };
      return;
    }
  }
}

/**
 * Seconds per tile before terrain. Villagers walk faster or slower with their
 * work efficiency (level, food, morale); land soldiers keep a steady marching
 * pace that only policies (soldierSpeed) change; ships use the normal pace.
 */
export function moveSecondsPerTile(state: GameState, v: Villager): number {
  if (v.soldier && !v.naval) {
    return BALANCE.combat.soldierMoveSecondsPerTile / getModifiers(getPlayer(state, v.owner)).soldierSpeed;
  }
  return BALANCE.moveSecondsPerTile / workEfficiency(state, v);
}

export function runJobs(state: GameState): void {
  // Construction materials on their way to sites.
  for (const b of state.buildings) if ((b.delivery ?? 0) > 0) b.delivery!--;
  for (const v of state.villagers) stepVillager(state, v);
}
