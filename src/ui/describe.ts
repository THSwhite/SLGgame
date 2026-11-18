import { BALANCE, BUILDINGS, RESOURCE_NAMES, TERRAIN } from '../sim/data';
import { colOf, rowOf } from '../sim/hex';
import { Knowledge, type GameState, type Villager } from '../sim/types';

export function villagerStatus(state: GameState, v: Villager): string {
  const o = v.order;
  const travelling = v.path.length > 0;
  switch (o.kind) {
    case 'idle':
      return '閒置';
    case 'move':
      return '移動中';
    case 'explore':
      return travelling ? `前往探索（${tileLabel(state, o.target)}）` : `探索中 ${Math.floor(o.progress * 100)}%`;
    case 'gather':
      return travelling ? `前往採集${RESOURCE_NAMES[o.resource]}` : `採集${RESOURCE_NAMES[o.resource]}中`;
    case 'construct':
    case 'work': {
      const id = o.building;
      const b = state.buildings.find((x) => x.id === id);
      const name = b ? BUILDINGS[b.type].name : '建築';
      if (o.kind === 'construct') return travelling ? `前往建造${name}` : `建造${name} ${Math.floor((b?.progress ?? 0) * 100)}%`;
      return travelling ? `前往${name}` : `在${name}工作`;
    }
  }
}

export function tileLabel(state: GameState, tile: number): string {
  return `${colOf(state, tile)},${rowOf(state, tile)}`;
}

export function terrainLabel(state: GameState, playerId: number, tile: number): string {
  const t = state.tiles[tile];
  const def = TERRAIN[t.terrain];
  if (!def.land) return def.name;
  return state.players[playerId].knowledge[tile] === Knowledge.Explored ? def.name : '未探索的陸地';
}

export function formatTime(tick: number): string {
  const sec = Math.floor(tick / BALANCE.ticksPerSecond);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
