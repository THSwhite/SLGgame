import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES, TECHS, TERRAIN, type BuildingType, type ResourceType } from './data';
import { canAfford, workersAt } from './economy';
import { deposit, fillStore, initStore, withdraw } from './storage';
import { hexDistance, neighbors, tilesInRadius } from './hex';
import { findPath, isWater, pathOpts } from './pathfinding';
import { getPlayer, logEvent, newVillager } from './state';
import { connectsToTerritory, distanceToTerritory, isComplete, recomputeTerritory } from './systems/territory';
import { researchBlocked } from './systems/research';
import { resolveCrisis, riseCandidate, type CrisisChoice } from './systems/crisis';
import { cityCount, cityLimit } from './systems/cities';
import { breakRelations, consulateOf, getRelation, setStatus } from './systems/diplomacy';
import { chooseAIStarts } from './ai/start';
import { updateVision } from './systems/vision';
import { Knowledge, type GameState, type Management, type Player, type PlayerId, type TileIndex, type Villager } from './types';

/**
 * Everything a player (human or AI) can do goes through a Command.
 * Commands are plain data so they can later be sent over the network
 * for lockstep multiplayer.
 */
export type Command =
  | { type: 'chooseStart'; player: PlayerId; tile: TileIndex }
  | { type: 'explore'; player: PlayerId; villager: number; tile: TileIndex }
  | { type: 'gather'; player: PlayerId; villager: number; tile: TileIndex; resource?: ResourceType }
  | { type: 'move'; player: PlayerId; villager: number; tile: TileIndex }
  | { type: 'stop'; player: PlayerId; villager: number }
  | { type: 'placeBuilding'; player: PlayerId; villager: number; tile: TileIndex; building: BuildingType }
  /** Send a villager to a building: construct it if unfinished, otherwise work there. */
  | { type: 'work'; player: PlayerId; villager: number; building: number }
  | { type: 'setManagement'; player: PlayerId; settings: Partial<Management> }
  | { type: 'train'; player: PlayerId; villager: number; building: number }
  | { type: 'setSoldier'; player: PlayerId; villager: number; soldier: boolean }
  | { type: 'garrison'; player: PlayerId; villager: number; building: number }
  /** Pick the tech or policy to research next (null clears it). */
  | { type: 'setResearch'; player: PlayerId; research: string | null }
  | { type: 'diplomacy'; player: PlayerId; target: PlayerId; action: DiplomacyAction }
  /** Soldiers march to a tile and fight enemies (at war) there. */
  | { type: 'attack'; player: PlayerId; villager: number; tile: TileIndex }
  /** Carry one resource (up to the carry capacity) from one own store to another. */
  | { type: 'transport'; player: PlayerId; villager: number; from: number; to: number; resource: ResourceType; amount: number }
  /** Train an LV2 soldier into navy at an own harbor (requires the navy tech). */
  | { type: 'trainNavy'; player: PlayerId; villager: number; building: number }
  /** After losing the last capital: surrender everything, or re-found the capital in a branch city. */
  | { type: 'capitalDecision'; player: PlayerId; choice: CrisisChoice }
  /** System command (multiplayer server only): a player disconnected, AI takes over. */
  | { type: 'playerLeft'; player: PlayerId };

export type DiplomacyAction =
  | 'proposeRelations'
  | 'proposePeace'
  | 'accept'
  | 'reject'
  | 'breakRelations'
  | 'declareWar';

export const MIN_START_DISTANCE = 10;

function ownVillager(state: GameState, player: PlayerId, id: number): Villager | null {
  const v = state.villagers.find((x) => x.id === id);
  return v && v.owner === player ? v : null;
}

function isLand(state: GameState, tile: TileIndex): boolean {
  const t = state.tiles[tile];
  return t !== undefined && TERRAIN[t.terrain].land;
}

function costText(cost: Partial<Record<ResourceType, number>>): string {
  return RESOURCE_TYPES.filter((r) => cost[r]).map((r) => `${RESOURCE_NAMES[r]} ${cost[r]}`).join('、');
}

/** Placement rules for a building, independent of which villager builds it. */
export function validatePlacement(state: GameState, player: Player, tile: TileIndex, type: BuildingType): string | null {
  const def = BUILDINGS[type];
  if (!def) return '未知的建築';
  if (!def.buildable) return '這種建築不能建造';
  const t = state.tiles[tile];
  if (!t || !TERRAIN[t.terrain].land) return '只能蓋在陸地上';
  if (player.knowledge[tile] !== Knowledge.Explored) return '需要先探索該地塊';
  if (state.buildings.some((b) => b.tile === tile)) return '這裡已經有建築了';
  if (def.territory === 'foreign') {
    if (t.owner === -1 || t.owner === player.id) return `${def.name}必須蓋在建交對象的國土內`;
    const rel = getRelation(state, player.id, t.owner);
    if (rel.status !== 'establishing' && rel.status !== 'allied') return `需要先和 ${state.players[t.owner].name} 建交`;
    if (consulateOf(state, player.id, t.owner)) return `已經在 ${state.players[t.owner].name} 設有領事館`;
    if (!canAfford(player, def.cost)) return `資源不足（需要 ${costText(def.cost)}）`;
    return null;
  }
  if (t.owner !== -1 && t.owner !== player.id) return '這是其他國家的國土';
  if (def.requiresTech && !player.researched.includes(def.requiresTech)) return `需要先研究「${TECHS[def.requiresTech]?.name ?? def.requiresTech}」`;
  if (def.placement === 'farmable' && !TERRAIN[t.terrain].farmable) return `${def.name}需要可耕作的土地（草地、泥地）`;
  if (def.placement === 'coastal' && !neighbors(state, tile).some((n) => isWater(state, n))) return `${def.name}只能蓋在海邊`;
  if (def.forbiddenTerrain?.includes(t.terrain)) return `${def.name}不能蓋在${TERRAIN[t.terrain].name}上`;
  if (def.territory === 'connected' && !connectsToTerritory(state, player.id, tile, def.territoryRadius)) {
    return '國土建築必須與現有國土相連';
  }
  const maxOut = def.maxOutsideDistance ?? BALANCE.nonTerritoryBuildingMaxDistance;
  if (def.territory === 'near' && distanceToTerritory(state, player.id, tile) > maxOut) {
    return maxOut === 0 ? '只能蓋在國土內' : `只能蓋在國土內或國土外 ${maxOut} 格內`;
  }
  if (def.territory === 'free' && type === 'city' && cityCount(state, player) >= cityLimit(state, player)) {
    const per = BALANCE.branchCity.territoryTilesPerCity;
    return `分城數量已達上限（每 ${per} 格國土 1 座，目前可蓋 ${cityLimit(state, player)} 座）`;
  }
  if (!canAfford(player, def.cost)) return `資源不足（需要 ${costText(def.cost)}）`;
  return null;
}

function validateDiplomacy(state: GameState, me: PlayerId, target: PlayerId, action: DiplomacyAction): string | null {
  if (target === me || !state.players[target]) return '無效的對象';
  const rel = getRelation(state, me, target);
  if (!rel.contact) return '尚未與對方接觸';
  const p = rel.proposal;
  switch (action) {
    case 'proposeRelations':
      if (rel.status !== 'none') return '目前狀態不能提議建交';
      if (state.tick < rel.cooldownUntil) return '冷卻期內（邦交破裂或提議被拒絕後），暫時不能提議建交';
      if (p) return '已經有待回覆的提議';
      return null;
    case 'proposePeace':
      if (rel.status !== 'war') return '沒有處於戰爭狀態';
      if (p) return '已經有待回覆的提議';
      return null;
    case 'accept':
    case 'reject':
      if (!p || p.from !== target) return '對方沒有提出提議';
      return null;
    case 'breakRelations':
      if (rel.status !== 'establishing' && rel.status !== 'allied') return '目前沒有邦交';
      return null;
    case 'declareWar':
      if (rel.status === 'war') return '已經處於戰爭狀態';
      return null;
  }
}

function applyDiplomacy(state: GameState, me: PlayerId, target: PlayerId, action: DiplomacyAction): void {
  const rel = getRelation(state, me, target);
  const myName = state.players[me].name;
  const theirName = state.players[target].name;
  const expires = state.tick + Math.round(BALANCE.diplomacy.proposalSeconds * BALANCE.ticksPerSecond);
  switch (action) {
    case 'proposeRelations':
      rel.proposal = { from: me, kind: 'relations', expires };
      logEvent(state, target, `${myName} 提議建立邦交`);
      logEvent(state, me, `向 ${theirName} 提議建立邦交`);
      return;
    case 'proposePeace':
      rel.proposal = { from: me, kind: 'peace', expires };
      logEvent(state, target, `${myName} 提議停戰`);
      logEvent(state, me, `向 ${theirName} 提議停戰`);
      return;
    case 'accept': {
      const kind = rel.proposal!.kind;
      if (kind === 'relations') {
        setStatus(state, rel, 'establishing');
        const msg = `建交成功！雙方需要在期限內在對方國土內建立領事館（正式邦交後共享地圖探索）`;
        logEvent(state, me, `與 ${theirName} ${msg}`);
        logEvent(state, target, `與 ${myName} ${msg}`);
      } else {
        setStatus(state, rel, 'none');
        logEvent(state, me, `與 ${theirName} 停戰`);
        logEvent(state, target, `與 ${myName} 停戰`);
      }
      return;
    }
    case 'reject':
      logEvent(state, target, `${myName} 拒絕了提議`);
      if (rel.proposal!.kind === 'relations') {
        rel.cooldownUntil = Math.max(rel.cooldownUntil, state.tick + Math.round(BALANCE.diplomacy.rejectCooldownSeconds * BALANCE.ticksPerSecond));
      }
      rel.proposal = null;
      return;
    case 'breakRelations':
      breakRelations(state, rel, `${myName} 主動斷交`);
      return;
    case 'declareWar':
      setStatus(state, rel, 'war');
      logEvent(state, target, `⚔ ${myName} 向我們宣戰！`);
      logEvent(state, me, `⚔ 向 ${theirName} 宣戰`);
      return;
  }
}

/** Returns an error message (zh-Hant) or null if the command is valid. */
export function validateCommand(state: GameState, cmd: Command): string | null {
  const player = state.players.find((p) => p.id === cmd.player);
  if (!player) return '未知的玩家';
  if (cmd.type === 'playerLeft') return player.isAI ? '已經由 AI 控制' : null;

  if (cmd.type === 'chooseStart') {
    if (state.phase !== 'choosingStart') return '已經開局了';
    if (player.startTile !== -1) return '已經選過起點';
    if (!isLand(state, cmd.tile)) return '起點必須在陸地上';
    for (const other of state.players) {
      if (other.startTile !== -1 && hexDistance(state, other.startTile, cmd.tile) < MIN_START_DISTANCE) {
        return '離其他國家太近';
      }
    }
    return null;
  }

  if (state.phase === 'ended') return '遊戲已經結束';
  if (state.phase !== 'playing') return '尚未開局';
  if (player.eliminated) return '你的國家已經滅亡';

  if (cmd.type === 'setManagement') {
    const i = cmd.settings.popIntervalSeconds;
    const { minIntervalSeconds: min, maxIntervalSeconds: max } = BALANCE.population;
    if (i !== undefined && !(i >= min && i <= max)) return `人口生產間隔必須在 ${min}～${max} 秒之間`;
    const at = cmd.settings.spawnAt;
    if (at !== undefined && at !== null) {
      const b = state.buildings.find((x) => x.id === at);
      if (!b || b.owner !== cmd.player || b.progress < 1 || (b.type !== 'camp' && b.type !== 'city')) return '只能選擇自己的主城或分城';
    }
    return null;
  }

  if (cmd.type === 'setResearch') {
    if (cmd.research === null) return null;
    return researchBlocked(player, cmd.research);
  }

  if (cmd.type === 'diplomacy') return validateDiplomacy(state, cmd.player, cmd.target, cmd.action);

  if (cmd.type === 'capitalDecision') {
    if (!player.capitalCrisis) return '主城沒有陷落';
    if (cmd.choice === 'rise' && !riseCandidate(state, player)) return '沒有可以再起的分城';
    return null;
  }

  const v = ownVillager(state, cmd.player, cmd.villager);
  if (!v) return '找不到這位村民';
  if (v.order.kind === 'train' && v.order.paid) return '訓練期間不能做其他事情';
  if (cmd.type === 'stop') return null;

  if (cmd.type === 'setSoldier') {
    if (v.naval) return '海軍無法解除士兵身分';
    if (cmd.soldier && !BALANCE.villagerLevels[String(v.level)].canEnlist) return 'LV1 村民不能從軍，請先到兵營訓練';
    return null;
  }

  const productive =
    cmd.type === 'gather' || cmd.type === 'work' || cmd.type === 'placeBuilding' || cmd.type === 'train' || cmd.type === 'transport';
  if (v.soldier && productive) return '士兵不能從事生產工作（可以先解除士兵身分）';
  if (!v.soldier && cmd.type === 'garrison') return '只有士兵可以駐守';
  if (v.naval && (cmd.type === 'garrison' || cmd.type === 'explore' || cmd.type === 'trainNavy')) {
    return cmd.type === 'trainNavy' ? '已經是海軍了' : '海軍只能在水上行動';
  }
  if (cmd.type === 'trainNavy') {
    if (!v.soldier || v.level < 2) return '只有 LV2 士兵可以訓練成海軍';
    if (!player.researched.includes(BALANCE.naval.navyTech)) return `需要先研究「${TECHS[BALANCE.naval.navyTech]?.name}」`;
    const b = state.buildings.find((x) => x.id === cmd.building);
    if (!b || b.owner !== cmd.player || !isComplete(b) || !BUILDINGS[b.type].navalTrainingSlots) return '只能在自己的港口訓練海軍';
    const slots = BUILDINGS[b.type].navalTrainingSlots!;
    const busy = state.villagers.filter((x) => x.id !== v.id && x.order.kind === 'train' && x.order.building === b.id).length;
    if (busy >= slots) return `訓練名額已滿（${slots} 人）`;
    if (!canAfford(player, BALANCE.naval.navy.cost)) return `資源不足（需要 ${costText(BALANCE.naval.navy.cost)}）`;
    if (findPath(state, v.tile, b.tile, pathOpts(v)) === null) return '無法抵達該地塊';
    return null;
  }
  if (!v.soldier && cmd.type === 'attack') return '只有士兵可以進攻';
  if (cmd.type === 'attack') {
    if (!v.naval && !isLand(state, cmd.tile)) return '一般士兵無法在海上攻擊，需要海軍';
    const foreign = new Set<PlayerId>();
    for (const x of state.villagers) if (x.tile === cmd.tile && x.owner !== cmd.player) foreign.add(x.owner);
    for (const b of state.buildings) if (b.tile === cmd.tile && b.owner !== cmd.player) foreign.add(b.owner);
    const t = state.tiles[cmd.tile].owner;
    if (t !== -1 && t !== cmd.player) foreign.add(t);
    if ([...foreign].some((f) => getRelation(state, cmd.player, f).status !== 'war') && ![...foreign].some((f) => getRelation(state, cmd.player, f).status === 'war')) {
      return '不能攻擊沒有宣戰的國家，請先宣戰';
    }
    if (findPath(state, v.tile, cmd.tile, pathOpts(v)) === null) return '無法抵達該地塊';
    return null;
  }

  if (cmd.type === 'transport') {
    const from = state.buildings.find((x) => x.id === cmd.from);
    const to = state.buildings.find((x) => x.id === cmd.to);
    const ok = (b: typeof from) => b && b.owner === cmd.player && b.progress >= 1 && b.store;
    if (!ok(from) || !ok(to)) return '只能在自己的城池或倉庫之間運送';
    if (from!.id === to!.id) return '起點和終點不能相同';
    if (!(cmd.amount > 0)) return '運送數量必須大於 0';
    if ((from!.store![cmd.resource] ?? 0) < 1) return `起點沒有${RESOURCE_NAMES[cmd.resource]}`;
    if (findPath(state, v.tile, from!.tile, pathOpts(v)) === null || findPath(state, from!.tile, to!.tile, pathOpts(v)) === null) return '無法抵達';
    return null;
  }

  if (cmd.type === 'train' || cmd.type === 'garrison') {
    const b = state.buildings.find((x) => x.id === cmd.building);
    if (!b || b.owner !== cmd.player) return '找不到這棟建築';
    if (!isComplete(b)) return '建築還沒蓋好';
    if (findPath(state, v.tile, b.tile, pathOpts(v)) === null) return '無法抵達該地塊';
    const def = BUILDINGS[b.type];
    if (cmd.type === 'train') {
      if (def.trainingSlots === 0) return `${def.name}不能訓練`;
      if (v.level >= BALANCE.training.maxLevel) return '已經是最高等級';
      const trainees = state.villagers.filter((x) => x.id !== v.id && x.order.kind === 'train' && x.order.building === b.id).length;
      if (trainees >= def.trainingSlots) return `訓練名額已滿（${def.trainingSlots} 人）`;
      return null;
    }
    if (def.garrisonSlots === 0) return `${def.name}不能駐守`;
    const stationed = state.villagers.filter((x) => x.id !== v.id && x.order.kind === 'garrison' && x.order.building === b.id).length;
    if (stationed >= def.garrisonSlots) return `駐守名額已滿（${def.garrisonSlots} 人）`;
    return null;
  }

  if (cmd.type === 'work') {
    const b = state.buildings.find((x) => x.id === cmd.building);
    if (!b || b.owner !== cmd.player) return '找不到這棟建築';
    if (findPath(state, v.tile, b.tile, pathOpts(v)) === null) return '無法抵達該地塊';
    if (!isComplete(b)) return null;
    const slots = BUILDINGS[b.type].workerSlots;
    if (slots === 0) return `${BUILDINGS[b.type].name}不需要工作人員`;
    const others = workersAt(state, b.id).filter((w) => w.id !== v.id).length;
    if (others >= slots) return `工作人員已滿（${slots} 人）`;
    return null;
  }

  if (cmd.type === 'placeBuilding') {
    const err = validatePlacement(state, player, cmd.tile, cmd.building);
    if (err) return err;
    if (findPath(state, v.tile, cmd.tile, pathOpts(v)) === null) return '無法抵達該地塊';
    return null;
  }

  if (!v.naval && !isLand(state, cmd.tile)) return '只能前往陸地（研究「航運」並建造港口後可以出海）';
  if (findPath(state, v.tile, cmd.tile, pathOpts(v)) === null) {
    return v.naval ? '海軍只能在水上和自己的港口行動' : '無法抵達該地塊（被水域隔開時需要港口與航運）';
  }

  switch (cmd.type) {
    case 'explore':
      if (player.knowledge[cmd.tile] === Knowledge.Explored) return '該地塊已經探索過';
      return null;
    case 'gather': {
      if (player.knowledge[cmd.tile] !== Knowledge.Explored) return '需要先探索該地塊';
      const ds = state.tiles[cmd.tile].deposits;
      const d = cmd.resource ? ds.find((x) => x.resource === cmd.resource) : ds[0];
      if (!d || d.amount <= 0) return '該地塊沒有可採集的資源';
      return null;
    }
    case 'move':
      return null;
  }
}

function startPlayer(state: GameState, player: PlayerId, tile: TileIndex): void {
  const p = getPlayer(state, player);
  p.startTile = tile;
  const camp: GameState['buildings'][number] = { id: state.nextEntityId++, type: 'camp', owner: player, tile, progress: 1, hp: BUILDINGS.camp.hp };
  state.buildings.push(camp);
  fillStore(state, camp, BALANCE.startingStock);
  for (let i = 0; i < BALANCE.startingVillagers; i++) newVillager(state, player, tile);
  for (const idx of tilesInRadius(state, tile, BALANCE.camp.exploredRadius)) {
    p.knowledge[idx] = Knowledge.Explored;
  }
  recomputeTerritory(state);
  logEvent(state, player, `${p.name} 在此建立了主城`);
  if (state.players.every((pl) => pl.startTile !== -1)) {
    state.phase = 'playing';
    updateVision(state);
  }
}

/** Apply a command. Invalid commands are ignored (returns the error). */
export function applyCommand(state: GameState, cmd: Command): string | null {
  const error = validateCommand(state, cmd);
  if (error) return error;

  if (cmd.type === 'playerLeft') {
    const p = getPlayer(state, cmd.player);
    p.isAI = true;
    p.ai = { aggression: 0.5, openness: 0.5, expansion: 0.5 };
    for (const other of state.players) logEvent(state, other.id, `${p.name} 的玩家離開了，改由 AI 接手`);
    if (state.phase === 'choosingStart' && state.players.every((pl) => pl.startTile !== -1 || pl.isAI)) {
      for (const [ai, tile] of chooseAIStarts(state)) startPlayer(state, ai, tile);
    }
    return null;
  }

  if (cmd.type === 'chooseStart') {
    startPlayer(state, cmd.player, cmd.tile);
    // Once every human has chosen, AI nations pick their own starts.
    if (state.players.every((pl) => pl.startTile !== -1 || pl.isAI)) {
      for (const [ai, tile] of chooseAIStarts(state)) startPlayer(state, ai, tile);
    }
    return null;
  }

  if (cmd.type === 'setManagement') {
    Object.assign(getPlayer(state, cmd.player).management, cmd.settings);
    return null;
  }
  if (cmd.type === 'setResearch') {
    getPlayer(state, cmd.player).currentResearch = cmd.research;
    return null;
  }
  if (cmd.type === 'diplomacy') {
    applyDiplomacy(state, cmd.player, cmd.target, cmd.action);
    return null;
  }
  if (cmd.type === 'capitalDecision') {
    resolveCrisis(state, getPlayer(state, cmd.player), cmd.choice);
    return null;
  }

  const v = ownVillager(state, cmd.player, cmd.villager)!;
  // Goods being carried are dropped at the nearest store when the carrier gets another job.
  if (v.cargo && cmd.type !== 'transport') {
    deposit(state, v.owner, v.tile, v.cargo.resource, v.cargo.amount);
    v.cargo = null;
  }
  if (cmd.type === 'setSoldier') {
    if (v.soldier !== cmd.soldier) {
      v.soldier = cmd.soldier;
      v.order = { kind: 'idle' };
      v.path = [];
      v.moveProgress = 0;
    }
    return null;
  }
  if (cmd.type === 'stop') {
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    return null;
  }

  let target: TileIndex;
  if (cmd.type === 'placeBuilding') {
    const id = state.nextEntityId++;
    const building = { id, type: cmd.building, owner: cmd.player, tile: cmd.tile, progress: 0, hp: BUILDINGS[cmd.building].hp } as GameState['buildings'][number];
    if (BUILDINGS[cmd.building].territory === 'foreign') building.host = state.tiles[cmd.tile].owner as PlayerId;
    // Materials come from the nearest stores and must be carried to the site first.
    const farthest = withdraw(state, cmd.player, cmd.tile, BUILDINGS[cmd.building].cost);
    building.delivery = Math.round(farthest * BALANCE.transport.deliverySecondsPerTile * BALANCE.ticksPerSecond);
    initStore(building);
    state.buildings.push(building);
    state.mapVersion++;
    target = cmd.tile;
    v.order = { kind: 'construct', building: id };
  } else if (cmd.type === 'transport') {
    const from = state.buildings.find((x) => x.id === cmd.from)!;
    target = from.tile;
    const amount = Math.min(cmd.amount, BALANCE.transport.carryCapacity);
    v.order = { kind: 'transport', from: cmd.from, to: cmd.to, resource: cmd.resource, amount, stage: 'pickup' };
  } else if (cmd.type === 'trainNavy') {
    const b = state.buildings.find((x) => x.id === cmd.building)!;
    target = b.tile;
    v.order = { kind: 'train', building: b.id, progress: 0, paid: false, navy: true };
  } else if (cmd.type === 'train' || cmd.type === 'garrison') {
    const b = state.buildings.find((x) => x.id === cmd.building)!;
    target = b.tile;
    v.order =
      cmd.type === 'train'
        ? { kind: 'train', building: b.id, progress: 0, paid: false }
        : { kind: 'garrison', building: b.id };
  } else if (cmd.type === 'work') {
    const b = state.buildings.find((x) => x.id === cmd.building)!;
    target = b.tile;
    v.order = isComplete(b) ? { kind: 'work', building: b.id } : { kind: 'construct', building: b.id };
  } else {
    target = cmd.tile;
  }

  // Finish the step in progress before re-routing, so units never teleport.
  const from = v.moveProgress > 0 && v.path.length > 0 ? v.path[0] : v.tile;
  const rest = findPath(state, from, target, pathOpts(v)) ?? [];
  v.path = from === v.tile ? rest : [from, ...rest];

  switch (cmd.type) {
    case 'placeBuilding':
    case 'work':
    case 'train':
    case 'garrison':
      break;
    case 'attack':
      v.order = { kind: 'attack', target: cmd.tile };
      break;
    case 'transport':
    case 'trainNavy':
      break;
    case 'explore':
      v.order = { kind: 'explore', target: cmd.tile, progress: 0 };
      break;
    case 'gather': {
      const ds = state.tiles[cmd.tile].deposits;
      const resource = cmd.resource ?? ds[0].resource;
      v.order = { kind: 'gather', target: cmd.tile, resource };
      break;
    }
    case 'move':
      v.order = { kind: 'move', target: cmd.tile };
      break;
  }
  return null;
}
