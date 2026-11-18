import { BALANCE, BUILDINGS, RESOURCE_NAMES, TERRAIN } from '../sim/data';
import { lacksWorkforce } from '../sim/systems/cities';
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
      if (o.kind === 'construct') {
        if (travelling) return `前往建造${name}`;
        if (b && lacksWorkforce(state, b)) return `等待人手（${name}需要周圍 ${BUILDINGS[b.type].minVillagersNearby} 位村民）`;
        return `建造${name} ${Math.floor((b?.progress ?? 0) * 100)}%`;
      }
      return travelling ? `前往${name}` : `在${name}工作`;
    }
    case 'train':
      if (travelling) return '前往兵營';
      return o.paid ? `訓練中 ${Math.floor(o.progress * 100)}%` : '等待訓練糧食';
    case 'garrison':
      return travelling ? '前往駐守' : '駐守瞭望塔';
    case 'attack':
      return travelling ? '行軍中' : '戰鬥中';
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

const WORK_ICONS: Record<string, string> = { farm: '🌾', mine: '⛏', lumber: '🪓', research: '📖' };
const GATHER_ICONS: Record<string, string> = { food: '🌾', wood: '🪓', stone: '⛏', ore: '⛏' };

/** Small icon for what a villager is doing right now ('' when idle). */
export function activityIcon(state: GameState, v: Villager): string {
  const o = v.order;
  switch (o.kind) {
    case 'idle':
      return '';
    case 'move':
      return '🚶';
    case 'explore':
      return '🔍';
    case 'gather':
      return GATHER_ICONS[o.resource] ?? '🧺';
    case 'construct':
      return '🔨';
    case 'work': {
      const id = o.building;
      const b = state.buildings.find((x) => x.id === id);
      return (b && WORK_ICONS[b.type]) ?? '🔧';
    }
    case 'train':
      return '🏋';
    case 'garrison':
      return '🛡';
    case 'attack':
      return '⚔';
  }
}
