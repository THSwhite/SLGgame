import { BALANCE, BUILDINGS, TECHS, TERRAIN, type BuildingType, type ResourceType } from '../data';
import { applyCommand, validatePlacement, type Command } from '../commands';
import { hexDistance, tilesInRadius } from '../hex';
import { adjacentForests, hasFreshWaterNearby, incomePerMinute, workersAt } from '../economy';
import { secondsToTicks } from '../state';
import { foodConsumptionPerMinute } from '../systems/food';
import { populationCap } from '../systems/population';
import { consulateOf, other, relationsOf } from '../systems/diplomacy';
import { researchBlocked } from '../systems/research';
import { garrisonOf, isComplete } from '../systems/territory';
import { Knowledge, type Building, type GameState, type Player, type Villager } from '../types';

/**
 * Rule-based AI. It only acts through Commands (same rules as humans) and only
 * uses what its nation knows (its own explored tiles), so it does not cheat
 * on the map. It runs inside the simulation, so it is deterministic.
 */
export function runAI(state: GameState): void {
  if (state.phase !== 'playing') return;
  const period = secondsToTicks(BALANCE.ai.thinkEverySeconds);
  for (const p of state.players) {
    if (!p.ai || p.startTile === -1) continue;
    if ((state.tick + p.id * 7) % period !== 0) continue;
    new Brain(state, p).think();
  }
}

class Brain {
  private me: Player;
  private villagers: Villager[];
  private buildings: Building[];
  private near: number[];
  private foodNet: number;

  constructor(
    private state: GameState,
    player: Player,
  ) {
    this.me = player;
    this.villagers = state.villagers.filter((v) => v.owner === player.id);
    this.buildings = state.buildings.filter((b) => b.owner === player.id);
    this.near = tilesInRadius(state, player.startTile, 12).sort(
      (a, b) => hexDistance(state, a, player.startTile) - hexDistance(state, b, player.startTile) || a - b,
    );
    this.foodNet = incomePerMinute(state, player).food - foodConsumptionPerMinute(state, player);
  }

  private get ai() {
    return this.me.ai!;
  }

  private issue(cmd: Command): boolean {
    return applyCommand(this.state, cmd) === null;
  }

  think() {
    this.diplomacy();
    this.research();
    this.military();
    this.economy();
  }

  // ---------- helpers ----------

  private count(type: BuildingType, completeOnly = false): number {
    return this.buildings.filter((b) => b.type === type && (!completeOnly || isComplete(b))).length;
  }

  private hasSite(type: BuildingType): boolean {
    return this.buildings.some((b) => b.type === type && !isComplete(b));
  }

  private soldiers(owner = this.me.id): number {
    return this.state.villagers.filter((v) => v.owner === owner && v.soldier).length;
  }

  private stock(r: ResourceType): number {
    return this.me.stock[r];
  }

  private affordable(type: BuildingType): boolean {
    const cost = BUILDINGS[type].cost as Partial<Record<ResourceType, number>>;
    return (Object.keys(cost) as ResourceType[]).every((r) => this.stock(r) >= (cost[r] ?? 0));
  }

  /** Place a building at the best-scoring valid tile. */
  private place(v: Villager, type: BuildingType, score: (tile: number) => number, tiles = this.near): boolean {
    if (!this.affordable(type)) return false;
    const valid = tiles.filter((t) => validatePlacement(this.state, this.me, t, type) === null);
    valid.sort((a, b) => score(b) - score(a) || a - b);
    for (const tile of valid.slice(0, 4)) {
      if (this.issue({ type: 'placeBuilding', player: this.me.id, villager: v.id, tile, building: type })) {
        this.buildings = this.state.buildings.filter((b) => b.owner === this.me.id);
        return true;
      }
    }
    return false;
  }

  private gather(v: Villager, resource: ResourceType): boolean {
    const tile = this.near.find(
      (t) =>
        this.me.knowledge[t] === Knowledge.Explored &&
        this.state.tiles[t].deposits.some((d) => d.resource === resource && d.amount > 5) &&
        !this.state.buildings.some((b) => b.tile === t && b.owner !== this.me.id),
    );
    if (tile === undefined) return false;
    return this.issue({ type: 'gather', player: this.me.id, villager: v.id, tile, resource });
  }

  private workAt(v: Villager, type: BuildingType): boolean {
    const b = this.buildings.find(
      (x) => x.type === type && isComplete(x) && workersAt(this.state, x.id).length < BUILDINGS[type].workerSlots,
    );
    if (!b) return false;
    return this.issue({ type: 'work', player: this.me.id, villager: v.id, building: b.id });
  }

  private explore(v: Villager): boolean {
    for (const radius of [12, 18]) {
      const tile = tilesInRadius(this.state, this.me.startTile, radius)
        .filter((t) => TERRAIN[this.state.tiles[t].terrain].land && this.me.knowledge[t] === Knowledge.Unknown)
        .sort((a, b) => hexDistance(this.state, a, v.tile) - hexDistance(this.state, b, v.tile) || a - b)[0];
      if (tile !== undefined) return this.issue({ type: 'explore', player: this.me.id, villager: v.id, tile });
    }
    return false;
  }

  // ---------- diplomacy ----------

  private diplomacy() {
    const { state, me } = this;
    for (const rel of relationsOf(state, me.id)) {
      if (!rel.contact) continue;
      const them = other(rel, me.id);
      const act = (action: Extract<Command, { type: 'diplomacy' }>['action']) =>
        this.issue({ type: 'diplomacy', player: me.id, target: them, action });
      const mine = this.soldiers();
      const theirs = this.soldiers(them);

      if (rel.proposal && rel.proposal.from === them) {
        if (rel.proposal.kind === 'relations') {
          act(this.ai.openness >= 0.3 && this.ai.aggression < 0.8 ? 'accept' : 'reject');
        } else {
          act(mine <= theirs * 1.2 || this.ai.aggression < 0.5 ? 'accept' : 'reject');
        }
        continue;
      }
      const since = state.tick - rel.since;
      // After a cooldown (rejection or break-up), the AI waits a while longer before trying again.
      const patience = rel.cooldownUntil > 0 ? secondsToTicks(300) : 0;
      if (rel.status === 'none' && !rel.proposal && state.tick >= rel.cooldownUntil + patience) {
        const warReady = mine >= 4 && mine >= theirs * 1.5 && state.tick > secondsToTicks(480);
        if (this.ai.aggression > 0.6 && warReady) act('declareWar');
        else if (this.ai.openness > 0.45 && since > secondsToTicks(30)) act('proposeRelations');
      } else if (rel.status === 'war' && !rel.proposal && since > secondsToTicks(60) && mine < theirs * 0.6) {
        act('proposePeace');
      }
    }
  }

  // ---------- research ----------

  private research() {
    const me = this.me;
    if (me.currentResearch) return;
    const { aggression, openness } = this.ai;
    const order = ['agriculture', 'tools', 'writing'];
    order.push(aggression > 0.5 ? 'warEconomy' : 'recuperate');
    order.push('forestry', 'masonry', 'mining', 'irrigation', 'drill');
    order.push(aggression > 0.66 ? 'heavy' : aggression > 0.33 ? 'light' : 'guerrilla');
    order.push(openness > 0.5 ? 'openDoor' : 'isolation');
    order.push(...Object.keys(TECHS));
    const next = order.find((id) => researchBlocked(me, id) === null);
    if (next) this.issue({ type: 'setResearch', player: me.id, research: next });
  }

  // ---------- military ----------

  private desiredSoldiers(): number {
    const pop = this.villagers.length;
    const atWar = this.me.atWar ? 2 : 0;
    return Math.floor(pop * (0.1 + 0.3 * this.ai.aggression)) + atWar;
  }

  private military() {
    const want = this.desiredSoldiers();
    let have = this.soldiers();
    for (const v of this.villagers) {
      if (have >= want) break;
      if (!v.soldier && v.level >= 2 && v.order.kind !== 'train' && v.order.kind !== 'construct') {
        if (this.issue({ type: 'setSoldier', player: this.me.id, villager: v.id, soldier: true })) have++;
      }
    }
    if (this.me.atWar) this.war();
    // Idle soldiers garrison towers with free slots.
    for (const v of this.villagers) {
      if (!v.soldier || v.order.kind !== 'idle' || v.path.length > 0) continue;
      const tower = this.buildings.find(
        (b) =>
          b.type === 'watchtower' &&
          isComplete(b) &&
          this.state.villagers.filter((x) => x.order.kind === 'garrison' && x.order.building === b.id).length <
            BUILDINGS.watchtower.garrisonSlots,
      );
      if (tower) this.issue({ type: 'garrison', player: this.me.id, villager: v.id, building: tower.id });
    }
  }

  private war() {
    const { state, me } = this;
    const enemies = new Set(relationsOf(state, me.id).filter((r) => r.status === 'war').map((r) => other(r, me.id)));
    const army = this.villagers.filter(
      (v) => v.soldier && v.path.length === 0 && (v.order.kind === 'idle' || v.order.kind === 'attack'),
    );
    const idleArmy = army.filter((v) => v.order.kind === 'idle');
    if (idleArmy.length === 0) return;
    const send = (tile: number) => {
      for (const v of idleArmy) this.issue({ type: 'attack', player: me.id, villager: v.id, tile });
    };

    // Defend: enemies seen inside our territory.
    const intruder = state.villagers.find((v) => enemies.has(v.owner) && state.tiles[v.tile].owner === me.id && me.visible[v.tile]);
    if (intruder) return send(intruder.tile);

    // Attack the nearest known enemy building once the army is big enough.
    if (army.length < 3) return;
    const targets = state.buildings
      .filter((b) => enemies.has(b.owner) && me.knowledge[b.tile] === Knowledge.Explored)
      .sort((a, b) => hexDistance(state, a.tile, me.startTile) - hexDistance(state, b.tile, me.startTile) || a.id - b.id);
    if (targets[0]) return send(targets[0].tile);
    // Unknown enemy location: scout towards their territory.
    const theirLand = state.tiles.findIndex((t) => t.owner !== -1 && enemies.has(t.owner));
    if (theirLand >= 0) send(theirLand);
  }

  // ---------- economy ----------

  private economy() {
    const free = this.villagers.filter((v) => !v.soldier && v.order.kind === 'idle' && v.path.length === 0);
    // Building jobs never run out, so workers never go idle by themselves:
    // pull one worker off a job when something more urgent needs doing.
    if (free.length === 0) {
      const v = this.rebalance();
      if (v) free.push(v);
    }
    for (const v of free) {
      if (this.assign(v)) continue;
      // Default jobs: wood while it is scarce, otherwise food, stone and exploration.
      if (this.stock('wood') < 300 && (this.workAt(v, 'lumber') || this.gather(v, 'wood'))) continue;
      this.workAt(v, 'farm') || this.workAt(v, 'mine') || this.gather(v, 'stone') || this.explore(v) || this.gather(v, 'food') || this.gather(v, 'wood');
    }
  }

  /** Which resource a villager is currently producing, if any. */
  private producing(v: Villager): ResourceType | 'research' | null {
    if (v.order.kind === 'gather') return v.order.resource;
    if (v.order.kind !== 'work') return null;
    const id = v.order.building;
    const b = this.buildings.find((x) => x.id === id);
    if (!b) return null;
    if (BUILDINGS[b.type].researchPerWorker) return 'research';
    const prod = BUILDINGS[b.type].production as Partial<Record<ResourceType, number>>;
    return (Object.keys(prod) as ResourceType[])[0] ?? null;
  }

  private rebalance(): Villager | null {
    const workers = this.villagers.filter((v) => !v.soldier && v.path.length === 0 && this.producing(v) !== null);
    const pick = (pred: (r: ResourceType | 'research') => boolean) =>
      workers.filter((v) => pred(this.producing(v)!)).sort((a, b) => b.id - a.id)[0] ?? null;
    const foodSafe = this.foodNet > 15;
    const notFood = (r: ResourceType | 'research') => r !== 'food' && r !== 'research';
    const pop = this.villagers.length;
    const cap = populationCap(this.state, this.me);

    // Housing is the usual bottleneck.
    if (cap - pop <= 1 && !this.hasSite('house') && this.affordable('house')) {
      return pick(notFood) ?? (foodSafe ? pick((r) => r === 'food') : null);
    }
    // Unattended construction site.
    const unattended = this.buildings.some(
      (b) => !isComplete(b) && !this.state.villagers.some((x) => x.order.kind === 'construct' && x.order.building === b.id),
    );
    if (unattended) return pick(notFood);
    // Nobody makes wood and we are short of it.
    const woodMakers = workers.filter((v) => this.producing(v) === 'wood').length;
    if (this.stock('wood') < 80 && woodMakers === 0) return pick((r) => r === 'stone' || r === 'ore') ?? (foodSafe ? pick((r) => r === 'food') : null);
    // Big surplus of something: move one producer elsewhere.
    for (const r of ['wood', 'stone', 'ore'] as ResourceType[]) {
      if (this.stock(r) > 500) {
        const v = pick((x) => x === r);
        if (v) return v;
      }
    }
    return null;
  }

  private explorers(): number {
    return this.villagers.filter((v) => v.order.kind === 'explore').length;
  }

  private assign(v: Villager): boolean {
    const { state, me } = this;
    const pop = this.villagers.length;
    const cap = populationCap(state, me);

    // 1. Help finish construction sites.
    const site = this.buildings.find(
      (b) =>
        !isComplete(b) &&
        state.villagers.filter((x) => x.order.kind === 'construct' && x.order.building === b.id).length < 2,
    );
    if (site && this.issue({ type: 'work', player: me.id, villager: v.id, building: site.id })) return true;

    // 2. Food.
    if (this.foodNet < 4 || this.stock('food') < 40) {
      if (this.workAt(v, 'farm')) {
        this.foodNet += 40;
        return true;
      }
      if (!this.hasSite('farm') && this.place(v, 'farm', (t) => (hasFreshWaterNearby(state, t) ? 10 : 0) - hexDistance(state, t, me.startTile))) {
        return true;
      }
      if (this.gather(v, 'food')) return true;
    }

    // 2b. A lumber camp early on, as close to forest as possible.
    if (pop >= 4 && this.count('lumber') === 0 && !this.hasSite('lumber')) {
      const forestScore = (t: number) =>
        (state.tiles[t].terrain === 'forest' ? 6 : 0) + adjacentForests(state, t) - hexDistance(state, t, me.startTile) * 0.5;
      if (this.place(v, 'lumber', forestScore)) return true;
    }
    if (this.stock('wood') < 150 && this.workAt(v, 'lumber')) return true;

    // 3. Housing.
    if (cap - pop <= 1 && !this.hasSite('house')) {
      if (this.place(v, 'house', (t) => -Math.abs(hexDistance(state, t, me.startTile) - 3) + this.ai.expansion)) return true;
    }

    // 4. Research.
    if (this.count('research') === 0 && pop >= 5) {
      if (this.place(v, 'research', (t) => -hexDistance(state, t, me.startTile))) return true;
    } else {
      const researchers = this.villagers.filter((x) => x.order.kind === 'work' && this.buildings.some((b) => b.id === (x.order as { building: number }).building && b.type === 'research')).length;
      if (researchers < (pop >= 8 ? 2 : 1) && this.workAt(v, 'research')) return true;
    }

    // 5. Barracks and training.
    if (this.count('barracks') === 0 && pop >= 6) {
      if (this.place(v, 'barracks', (t) => -hexDistance(state, t, me.startTile))) return true;
    }
    const lv2 = this.villagers.filter((x) => x.level >= 2).length;
    const barracks = this.buildings.find((b) => b.type === 'barracks' && isComplete(b));
    if (barracks && v.level === 1 && lv2 < this.desiredSoldiers() + 1 && this.stock('food') > 60) {
      if (this.issue({ type: 'train', player: me.id, villager: v.id, building: barracks.id })) return true;
    }

    // 6. Stone.
    if (this.stock('stone') < 80) {
      if (this.workAt(v, 'mine')) return true;
      if (this.count('mine') === 0) {
        const stoneTiles = this.near.filter((t) => state.tiles[t].terrain === 'stone');
        if (stoneTiles.length && this.place(v, 'mine', (t) => -hexDistance(state, t, me.startTile), stoneTiles)) return true;
        // No stone anywhere we know: a weak mine on ordinary land beats having none.
        if (!stoneTiles.some((t) => me.knowledge[t] === Knowledge.Explored) && pop >= 6) {
          if (this.place(v, 'mine', (t) => -hexDistance(state, t, me.startTile))) return true;
        }
      }
      if (this.gather(v, 'stone')) return true;
    }

    // 7. Watchtowers for the soldiers to man.
    const towers = this.count('watchtower');
    if (this.soldiers() > towers * 2 && !this.hasSite('watchtower') && towers < 4) {
      if (this.place(v, 'watchtower', (t) => hexDistance(state, t, me.startTile) + this.ai.expansion * 2)) return true;
    }

    // 8. Consulates for nations we are establishing relations with.
    for (const rel of relationsOf(state, me.id)) {
      if (rel.status !== 'establishing' && rel.status !== 'allied') continue;
      const them = other(rel, me.id);
      if (consulateOf(state, me.id, them)) continue;
      const theirLand = state.tiles.map((_, i) => i).filter((i) => state.tiles[i].owner === them);
      const known = theirLand.filter((i) => me.knowledge[i] === Knowledge.Explored);
      if (known.length && this.place(v, 'consulate', (t) => -hexDistance(state, t, me.startTile), known)) return true;
      const target = theirLand
        .filter((i) => me.knowledge[i] === Knowledge.Unknown)
        .sort((a, b) => hexDistance(state, a, v.tile) - hexDistance(state, b, v.tile) || a - b)[0];
      if (target !== undefined && this.issue({ type: 'explore', player: me.id, villager: v.id, tile: target })) return true;
    }

    // 9. Keep exploring.
    const knowsStone = this.near.some((t) => this.me.knowledge[t] === Knowledge.Explored && this.state.tiles[t].terrain === 'stone');
    const wantExplorers = 1 + Math.round(this.ai.expansion) + (knowsStone ? 0 : 1);
    if (this.explorers() < wantExplorers && this.explore(v)) return true;

    return false;
  }
}

export function garrisonCount(state: GameState, b: Building): number {
  return garrisonOf(state, b).length;
}
