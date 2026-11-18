import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES, TERRAIN, type BuildingType, type ResourceType } from './data';
import { canAfford, pay, workersAt } from './economy';
import { hexDistance, tilesInRadius } from './hex';
import { findPath } from './pathfinding';
import { getPlayer, logEvent } from './state';
import { connectsToTerritory, distanceToTerritory, isComplete, recomputeTerritory } from './systems/territory';
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
  | { type: 'setManagement'; player: PlayerId; settings: Partial<Management> };

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
  if (t.owner !== -1 && t.owner !== player.id) return '這是其他國家的國土';
  if (def.placement === 'farmable' && !TERRAIN[t.terrain].farmable) return `${def.name}需要可耕作的土地（草地、泥地）`;
  if (def.territory === 'connected' && !connectsToTerritory(state, player.id, tile, def.territoryRadius)) {
    return '國土建築必須與現有國土相連';
  }
  if (def.territory === 'near' && distanceToTerritory(state, player.id, tile) > BALANCE.nonTerritoryBuildingMaxDistance) {
    return `只能蓋在國土內或國土外 ${BALANCE.nonTerritoryBuildingMaxDistance} 格內`;
  }
  if (!canAfford(player, def.cost)) return `資源不足（需要 ${costText(def.cost)}）`;
  return null;
}

/** Returns an error message (zh-Hant) or null if the command is valid. */
export function validateCommand(state: GameState, cmd: Command): string | null {
  const player = state.players.find((p) => p.id === cmd.player);
  if (!player) return '未知的玩家';

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

  if (state.phase !== 'playing') return '尚未開局';

  if (cmd.type === 'setManagement') {
    const i = cmd.settings.popIntervalSeconds;
    const { minIntervalSeconds: min, maxIntervalSeconds: max } = BALANCE.population;
    if (i !== undefined && !(i >= min && i <= max)) return `人口生產間隔必須在 ${min}～${max} 秒之間`;
    return null;
  }

  const v = ownVillager(state, cmd.player, cmd.villager);
  if (!v) return '找不到這位村民';
  if (cmd.type === 'stop') return null;

  if (cmd.type === 'work') {
    const b = state.buildings.find((x) => x.id === cmd.building);
    if (!b || b.owner !== cmd.player) return '找不到這棟建築';
    if (findPath(state, v.tile, b.tile) === null) return '無法抵達該地塊';
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
    if (findPath(state, v.tile, cmd.tile) === null) return '無法抵達該地塊';
    return null;
  }

  if (!isLand(state, cmd.tile)) return '只能前往陸地';
  if (findPath(state, v.tile, cmd.tile) === null) return '無法抵達該地塊';

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
  state.buildings.push({ id: state.nextEntityId++, type: 'camp', owner: player, tile, progress: 1 });
  for (let i = 0; i < BALANCE.startingVillagers; i++) {
    state.villagers.push({
      id: state.nextEntityId++,
      owner: player,
      level: 1,
      tile,
      path: [],
      moveProgress: 0,
      order: { kind: 'idle' },
    });
  }
  for (const idx of tilesInRadius(state, tile, BALANCE.camp.exploredRadius)) {
    p.knowledge[idx] = Knowledge.Explored;
  }
  recomputeTerritory(state);
  logEvent(state, player, `${p.name} 在此建立了營地`);
  if (state.players.every((pl) => pl.startTile !== -1)) {
    state.phase = 'playing';
    updateVision(state);
  }
}

/** Apply a command. Invalid commands are ignored (returns the error). */
export function applyCommand(state: GameState, cmd: Command): string | null {
  const error = validateCommand(state, cmd);
  if (error) return error;

  if (cmd.type === 'chooseStart') {
    startPlayer(state, cmd.player, cmd.tile);
    return null;
  }

  if (cmd.type === 'setManagement') {
    Object.assign(getPlayer(state, cmd.player).management, cmd.settings);
    return null;
  }

  const v = ownVillager(state, cmd.player, cmd.villager)!;
  if (cmd.type === 'stop') {
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    return null;
  }

  let target: TileIndex;
  if (cmd.type === 'placeBuilding') {
    const p = getPlayer(state, cmd.player);
    pay(p, BUILDINGS[cmd.building].cost);
    const id = state.nextEntityId++;
    state.buildings.push({ id, type: cmd.building, owner: cmd.player, tile: cmd.tile, progress: 0 });
    state.mapVersion++;
    target = cmd.tile;
    v.order = { kind: 'construct', building: id };
  } else if (cmd.type === 'work') {
    const b = state.buildings.find((x) => x.id === cmd.building)!;
    target = b.tile;
    v.order = isComplete(b) ? { kind: 'work', building: b.id } : { kind: 'construct', building: b.id };
  } else {
    target = cmd.tile;
  }

  // Finish the step in progress before re-routing, so units never teleport.
  const from = v.moveProgress > 0 && v.path.length > 0 ? v.path[0] : v.tile;
  const rest = findPath(state, from, target) ?? [];
  v.path = from === v.tile ? rest : [from, ...rest];

  switch (cmd.type) {
    case 'placeBuilding':
    case 'work':
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
