import { BALANCE, TERRAIN, type ResourceType } from './data';
import { hexDistance, tilesInRadius } from './hex';
import { findPath } from './pathfinding';
import { getPlayer, logEvent } from './state';
import { recomputeTerritory } from './systems/territory';
import { updateVision } from './systems/vision';
import { Knowledge, type GameState, type PlayerId, type TileIndex, type Villager } from './types';

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
  | { type: 'stop'; player: PlayerId; villager: number };

export const MIN_START_DISTANCE = 10;

function ownVillager(state: GameState, player: PlayerId, id: number): Villager | null {
  const v = state.villagers.find((x) => x.id === id);
  return v && v.owner === player ? v : null;
}

function isLand(state: GameState, tile: TileIndex): boolean {
  const t = state.tiles[tile];
  return t !== undefined && TERRAIN[t.terrain].land;
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
  const v = ownVillager(state, cmd.player, cmd.villager);
  if (!v) return '找不到這位村民';
  if (cmd.type === 'stop') return null;

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
  state.buildings.push({ id: state.nextEntityId++, type: 'camp', owner: player, tile });
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

  const v = ownVillager(state, cmd.player, cmd.villager)!;
  if (cmd.type === 'stop') {
    v.order = { kind: 'idle' };
    v.path = [];
    v.moveProgress = 0;
    return null;
  }

  // Finish the step in progress before re-routing, so units never teleport.
  const from = v.moveProgress > 0 && v.path.length > 0 ? v.path[0] : v.tile;
  const rest = findPath(state, from, cmd.tile) ?? [];
  v.path = from === v.tile ? rest : [from, ...rest];

  switch (cmd.type) {
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
