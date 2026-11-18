import { Application, Container, Graphics, Text } from 'pixi.js';
import { activityIcon } from '../ui/describe';
import { BALANCE, BUILDINGS, TERRAIN, type ResourceType } from '../sim/data';
import { colOf, inBounds, neighborInDir, rowOf, toIndex } from '../sim/hex';
import { Knowledge, type Building, type GameState } from '../sim/types';
import type { GameController } from './controller';

export const HEX_SIZE = 26;
const SQRT3 = Math.sqrt(3);

const UNKNOWN_LAND = 0x6e6a5c;
const RESOURCE_COLORS: Record<ResourceType, number> = {
  food: 0xff7043,
  wood: 0x5d4037,
  stone: 0xeceff1,
  ore: 0xffca28,
};

export function tileCenter(state: GameState, index: number): [number, number] {
  const col = colOf(state, index);
  const row = rowOf(state, index);
  return [HEX_SIZE * SQRT3 * (col + 0.5 * (row & 1)), HEX_SIZE * 1.5 * row];
}

/** Corner k of a pointy-top hex (k=0 at -30°, going clockwise on screen). */
function corner(cx: number, cy: number, k: number, size = HEX_SIZE): [number, number] {
  const angle = ((60 * k - 30) * Math.PI) / 180;
  return [cx + size * Math.cos(angle), cy + size * Math.sin(angle)];
}

function hexPoints(cx: number, cy: number, size = HEX_SIZE): number[] {
  const pts: number[] = [];
  for (let k = 0; k < 6; k++) pts.push(...corner(cx, cy, k, size));
  return pts;
}

/** Corner pair forming the edge shared with neighbour direction d (E, NE, NW, W, SW, SE). */
const EDGE_CORNERS: Array<[number, number]> = [
  [0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2],
];

function pixelToTile(state: GameState, x: number, y: number): number {
  const q = ((SQRT3 / 3) * x - y / 3) / HEX_SIZE;
  const r = ((2 / 3) * y) / HEX_SIZE;
  // Cube rounding.
  let rx = Math.round(q);
  let rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - (-q - r));
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (!(dy > dz)) rz = -rx - ry;
  const row = rz;
  const col = rx + (row - (row & 1)) / 2;
  return inBounds(state, col, row) ? toIndex(state, col, row) : -1;
}

function darken(color: number, factor: number): number {
  const r = ((color >> 16) & 0xff) * factor;
  const g = ((color >> 8) & 0xff) * factor;
  const b = (color & 0xff) * factor;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function hex(color: string): number {
  return parseInt(color.slice(1), 16);
}

export interface RendererCallbacks {
  onTileClick(tile: number, button: 'left' | 'right'): void;
}

export class MapRenderer {
  private app = new Application();
  private world = new Container();
  private tileLayer = new Graphics();
  private overlay = new Graphics();
  private units = new Graphics();
  /** Activity icons above villagers, one cached Text per villager id. */
  private icons = new Container();
  private iconTexts = new Map<number, Text>();
  private drawnVersion = -1;
  private drawnState: GameState | null = null;
  private hoverTile = -1;
  private destroyed = false;

  constructor(
    private controller: GameController,
    private callbacks: RendererCallbacks,
  ) {}

  async mount(host: HTMLElement) {
    await this.app.init({ resizeTo: host, background: 0x0b1a2e, antialias: true });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.world.addChild(this.tileLayer, this.overlay, this.units, this.icons);
    this.app.stage.addChild(this.world);
    this.setupInput();
    this.centerOn(Math.floor(this.controller.state.tiles.length / 2) + this.controller.state.width / 2);
    this.app.ticker.add((t) => {
      this.controller.update(t.deltaMS);
      this.draw();
    });
  }

  destroy() {
    this.destroyed = true;
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }

  centerOn(tile: number) {
    const [x, y] = tileCenter(this.controller.state, tile);
    const s = this.world.scale.x;
    this.world.position.set(this.app.screen.width / 2 - x * s, this.app.screen.height / 2 - y * s);
  }

  private setupInput() {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;

    let dragStart: { x: number; y: number; wx: number; wy: number } | null = null;
    let dragged = false;

    stage.on('pointerdown', (e) => {
      if (e.button === 0 || e.button === 1) {
        dragStart = { x: e.global.x, y: e.global.y, wx: this.world.x, wy: this.world.y };
        dragged = false;
      }
    });
    stage.on('pointermove', (e) => {
      const local = this.world.toLocal(e.global);
      this.hoverTile = pixelToTile(this.controller.state, local.x, local.y);
      if (dragStart) {
        const dx = e.global.x - dragStart.x;
        const dy = e.global.y - dragStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) dragged = true;
        if (dragged) this.world.position.set(dragStart.wx + dx, dragStart.wy + dy);
      }
    });
    const end = (e: { button: number; global: { x: number; y: number } }) => {
      const wasDrag = dragged;
      dragStart = null;
      dragged = false;
      if (wasDrag) return;
      const local = this.world.toLocal(e.global);
      const tile = pixelToTile(this.controller.state, local.x, local.y);
      if (tile < 0) return;
      if (e.button === 0) this.callbacks.onTileClick(tile, 'left');
      else if (e.button === 2) this.callbacks.onTileClick(tile, 'right');
    };
    stage.on('pointerup', end);
    stage.on('pointerupoutside', () => {
      dragStart = null;
      dragged = false;
    });

    this.app.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const old = this.world.scale.x;
        const next = Math.min(2.5, Math.max(0.35, old * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const rect = this.app.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const wx = (mx - this.world.x) / old;
        const wy = (my - this.world.y) / old;
        this.world.scale.set(next);
        this.world.position.set(mx - wx * next, my - wy * next);
      },
      { passive: false },
    );
  }

  private draw() {
    const state = this.controller.state;
    if (state !== this.drawnState) {
      // A new game was started.
      this.drawnState = state;
      this.drawnVersion = -1;
      this.centerOn(Math.floor(state.tiles.length / 2) + Math.floor(state.width / 2));
    }
    if (state.mapVersion !== this.drawnVersion) {
      this.drawTiles(state);
      this.drawnVersion = state.mapVersion;
    }
    this.drawOverlay(state);
    this.drawUnits(state);
  }

  private drawTiles(state: GameState) {
    const g = this.tileLayer;
    g.clear();
    const me = state.players[this.controller.localPlayer];
    const choosing = state.phase === 'choosingStart';

    for (let i = 0; i < state.tiles.length; i++) {
      const tile = state.tiles[i];
      const def = TERRAIN[tile.terrain];
      const [cx, cy] = tileCenter(state, i);
      const explored = me.knowledge[i] === Knowledge.Explored;
      const visible = me.visible[i] === 1;

      let color: number;
      if (!def.land) color = hex(def.color);
      else if (explored) color = hex(def.color);
      else color = UNKNOWN_LAND;
      if (!choosing && !visible && (explored || !def.land)) color = darken(color, 0.62);
      if (!choosing && !visible && !explored && def.land) color = darken(color, 0.8);

      g.poly(hexPoints(cx, cy)).fill(color).stroke({ color: 0x000000, alpha: 0.18, width: 1 });

      if (explored && def.land) {
        tile.deposits.slice(0, 3).forEach((d, k) => {
          const ox = cx - 10 + k * 10;
          const oy = cy + 10;
          const c = RESOURCE_COLORS[d.resource];
          if (d.resource === 'wood') g.poly([ox, oy - 6, ox - 5, oy + 4, ox + 5, oy + 4]).fill(c).stroke({ color: 0xc8e6c9, width: 1 });
          else if (d.resource === 'stone') g.rect(ox - 4, oy - 4, 8, 8).fill(c).stroke({ color: 0x424242, width: 1 });
          else if (d.resource === 'ore') g.poly([ox, oy - 5, ox + 5, oy, ox, oy + 5, ox - 5, oy]).fill(c).stroke({ color: 0x5d4037, width: 1 });
          else g.circle(ox, oy, 4).fill(c).stroke({ color: 0x3e2723, width: 1 });
        });
      }
    }

    // Territory: tint + borders in the owner's colour (only what I can see/know).
    for (let i = 0; i < state.tiles.length; i++) {
      const owner = state.tiles[i].owner;
      if (owner === -1) continue;
      if (owner !== me.id && me.visible[i] !== 1) continue;
      const pc = hex(state.players[owner].color);
      const [cx, cy] = tileCenter(state, i);
      g.poly(hexPoints(cx, cy)).fill({ color: pc, alpha: 0.14 });
      for (let d = 0; d < 6; d++) {
        const n = neighborInDir(state, i, d);
        if (n !== -1 && state.tiles[n].owner === owner) continue;
        const [a, b] = EDGE_CORNERS[d];
        const [x1, y1] = corner(cx, cy, a, HEX_SIZE - 1.5);
        const [x2, y2] = corner(cx, cy, b, HEX_SIZE - 1.5);
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: pc, width: 3, alpha: 0.9 });
      }
    }

  }

  private drawOverlay(state: GameState) {
    const g = this.overlay;
    g.clear();
    const sel = this.controller.selection;
    if (this.hoverTile >= 0) {
      const [cx, cy] = tileCenter(state, this.hoverTile);
      let color = 0xffffff;
      if (state.phase === 'choosingStart') color = TERRAIN[state.tiles[this.hoverTile].terrain].land ? 0x66ff66 : 0xff5252;
      g.poly(hexPoints(cx, cy, HEX_SIZE - 2)).stroke({ color, width: 2, alpha: 0.7 });
    }
    if (sel.tile !== null) {
      const [cx, cy] = tileCenter(state, sel.tile);
      g.poly(hexPoints(cx, cy, HEX_SIZE - 2)).stroke({ color: 0xffeb3b, width: 3 });
    }
    // Planned path of the selected villager.
    const v = state.villagers.find((x) => x.id === sel.villager);
    if (v && v.path.length > 0) {
      let [px, py] = this.villagerPos(state, v.id);
      for (const step of v.path) {
        const [x, y] = tileCenter(state, step);
        g.moveTo(px, py).lineTo(x, y).stroke({ color: 0xffffff, width: 2, alpha: 0.5 });
        px = x;
        py = y;
      }
      g.circle(px, py, 4).fill({ color: 0xffffff, alpha: 0.7 });
    }
  }

  private villagerPos(state: GameState, id: number): [number, number] {
    const v = state.villagers.find((x) => x.id === id)!;
    let [x, y] = tileCenter(state, v.tile);
    if (v.path.length > 0 && v.moveProgress > 0) {
      const [nx, ny] = tileCenter(state, v.path[0]);
      x += (nx - x) * v.moveProgress;
      y += (ny - y) * v.moveProgress;
    }
    return [x, y];
  }

  private drawBuilding(g: Graphics, state: GameState, b: Building) {
    const [cx, cy] = tileCenter(state, b.tile);
    const pc = hex(state.players[b.owner].color);
    const done = b.progress >= 1;
    const alpha = done ? 1 : 0.45;
    const line = { color: 0x3e2723, width: 1.5, alpha };
    switch (b.type) {
      case 'camp':
        g.rect(cx - 9, cy - 4, 18, 12).fill({ color: 0xf5e6c8, alpha }).stroke(line);
        g.poly([cx - 12, cy - 4, cx, cy - 14, cx + 12, cy - 4]).fill({ color: pc, alpha }).stroke(line);
        break;
      case 'city':
        // Small walled town: wall, two towers and a flag.
        g.rect(cx - 12, cy - 4, 24, 12).fill({ color: 0xd7ccc8, alpha }).stroke(line);
        g.rect(cx - 14, cy - 10, 6, 18).fill({ color: 0xbcaaa4, alpha }).stroke(line);
        g.rect(cx + 8, cy - 10, 6, 18).fill({ color: 0xbcaaa4, alpha }).stroke(line);
        g.poly([cx - 6, cy - 4, cx, cy - 12, cx + 6, cy - 4]).fill({ color: pc, alpha }).stroke(line);
        g.moveTo(cx, cy - 12).lineTo(cx, cy - 20).stroke({ color: 0x3e2723, width: 1.5, alpha });
        g.rect(cx, cy - 20, 7, 4).fill({ color: pc, alpha });
        break;
      case 'house':
        g.rect(cx - 6, cy - 3, 12, 9).fill({ color: 0xd7ccc8, alpha }).stroke(line);
        g.poly([cx - 8, cy - 3, cx, cy - 10, cx + 8, cy - 3]).fill({ color: pc, alpha }).stroke(line);
        break;
      case 'farm':
        g.roundRect(cx - 12, cy - 9, 24, 16, 3).fill({ color: 0xc0a35a, alpha }).stroke(line);
        for (let k = 0; k < 3; k++) {
          g.moveTo(cx - 10, cy - 5 + k * 5).lineTo(cx + 10, cy - 5 + k * 5).stroke({ color: 0x9ccc65, width: 2, alpha });
        }
        g.circle(cx + 11, cy - 9, 3).fill({ color: pc, alpha });
        break;
      case 'barracks':
        g.rect(cx - 11, cy - 6, 22, 13).fill({ color: 0x8d6e63, alpha }).stroke(line);
        g.rect(cx - 11, cy - 9, 22, 4).fill({ color: pc, alpha }).stroke(line);
        g.moveTo(cx - 5, cy + 5).lineTo(cx + 5, cy - 3).stroke({ color: 0xeeeeee, width: 2, alpha });
        g.moveTo(cx + 5, cy + 5).lineTo(cx - 5, cy - 3).stroke({ color: 0xeeeeee, width: 2, alpha });
        break;
      case 'watchtower': {
        const active = done && state.villagers.some((v) => v.order.kind === 'garrison' && v.order.building === b.id && v.path.length === 0);
        g.poly([cx - 6, cy + 9, cx - 3, cy - 10, cx + 3, cy - 10, cx + 6, cy + 9]).fill({ color: 0xa1887f, alpha }).stroke(line);
        g.rect(cx - 7, cy - 14, 14, 5).fill({ color: active ? pc : 0x757575, alpha }).stroke(line);
        if (done && !active) g.circle(cx + 9, cy - 12, 4).fill(0x212121).stroke({ color: 0xffca28, width: 1.5 });
        break;
      }
      case 'consulate':
        g.rect(cx - 9, cy - 5, 18, 12).fill({ color: 0xfafafa, alpha }).stroke(line);
        g.rect(cx - 9, cy - 8, 18, 3).fill({ color: 0x90a4ae, alpha }).stroke(line);
        g.moveTo(cx + 9, cy - 8).lineTo(cx + 9, cy - 18).stroke({ color: 0x3e2723, width: 1.5, alpha });
        g.rect(cx + 9, cy - 18, 8, 5).fill({ color: pc, alpha });
        break;
      case 'research':
        g.rect(cx - 10, cy - 4, 20, 11).fill({ color: 0xe3f2fd, alpha }).stroke(line);
        g.poly([cx - 12, cy - 4, cx, cy - 13, cx + 12, cy - 4]).fill({ color: 0x5c6bc0, alpha }).stroke(line);
        g.circle(cx, cy + 1, 3).fill({ color: pc, alpha });
        break;
      case 'lumber':
        // Log pile with a little roof.
        for (let k = 0; k < 3; k++) {
          g.roundRect(cx - 11, cy - 1 + k * 4, 22, 4, 2).fill({ color: k % 2 ? 0x8d6e63 : 0xa1887f, alpha }).stroke({ ...line, width: 1 });
        }
        g.poly([cx - 12, cy - 2, cx, cy - 11, cx + 12, cy - 2]).fill({ color: 0x4e342e, alpha }).stroke(line);
        g.circle(cx + 10, cy - 9, 3).fill({ color: pc, alpha });
        break;
      case 'mine':
        g.poly([cx - 12, cy + 7, cx, cy - 11, cx + 12, cy + 7]).fill({ color: 0x616161, alpha }).stroke(line);
        g.poly([cx - 4, cy + 7, cx - 4, cy + 1, cx, cy - 2, cx + 4, cy + 1, cx + 4, cy + 7]).fill({ color: 0x212121, alpha });
        g.circle(cx + 10, cy - 7, 3).fill({ color: pc, alpha });
        break;
    }
    if (!done) {
      g.rect(cx - 12, cy + 12, 24, 4).fill(0x222222);
      g.rect(cx - 12, cy + 12, 24 * b.progress, 4).fill(0x81c784);
    }
    const maxHp = BUILDINGS[b.type].hp;
    if (b.hp < maxHp) {
      g.rect(cx - 12, cy + 17, 24, 3).fill(0x222222);
      g.rect(cx - 12, cy + 17, 24 * Math.max(0, b.hp / maxHp), 3).fill(0xef5350);
    }
  }

  private placeIcon(state: GameState, v: GameState['villagers'][number], x: number, y: number, seen: Set<number>) {
    const icon = activityIcon(state, v);
    if (!icon) return;
    seen.add(v.id);
    let t = this.iconTexts.get(v.id);
    if (!t) {
      t = new Text({ text: icon, style: { fontSize: 13 } });
      t.anchor.set(0.5, 1);
      this.icons.addChild(t);
      this.iconTexts.set(v.id, t);
    } else if (t.text !== icon) {
      t.text = icon;
    }
    t.position.set(x + 7, y - 7);
  }

  private drawUnits(state: GameState) {
    const g = this.units;
    g.clear();
    const me = state.players[this.controller.localPlayer];
    for (const b of state.buildings) {
      if (b.owner !== me.id && me.visible[b.tile] !== 1) continue;
      this.drawBuilding(g, state, b);
    }
    // Fighting: pulsing red rings.
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    for (const t of state.combatTiles) {
      if (me.visible[t] !== 1) continue;
      const [cx, cy] = tileCenter(state, t);
      g.circle(cx, cy, HEX_SIZE - 4).stroke({ color: 0xff1744, width: 2 + pulse * 2, alpha: 0.6 + 0.4 * pulse });
    }
    const group = new Set(this.controller.selection.group);
    const seen = new Set<number>();
    const perTile = new Map<number, number>();
    for (const v of state.villagers) {
      if (v.owner !== me.id && me.visible[v.tile] !== 1) continue;
      const slot = perTile.get(v.tile) ?? 0;
      perTile.set(v.tile, slot + 1);
      let [x, y] = this.villagerPos(state, v.id);
      x += (slot - 1) * 9;
      // Stand above buildings so both stay visible.
      y += state.buildings.some((b) => b.tile === v.tile) && v.path.length === 0 ? -15 : -2;
      const selected = this.controller.selection.villager === v.id || group.has(v.id);
      this.placeIcon(state, v, x, y, seen);
      if (selected) g.circle(x, y, 8.5).stroke({ color: 0xffffff, width: 2.5 });
      const color = hex(state.players[v.owner].color);
      if (v.soldier) {
        g.poly([x, y - 7, x + 7, y, x, y + 7, x - 7, y]).fill(color).stroke({ color: 0xffffff, width: 1.5 });
      } else {
        g.circle(x, y, v.level >= 2 ? 6.5 : 6).fill(color).stroke({ color: v.level >= 2 ? 0xffd54f : 0x1a1a1a, width: 1.5 });
      }
      const maxHp = BALANCE.combat.hp[String(v.level)];
      if (v.hp < maxHp) {
        g.rect(x - 7, y + 8, 14, 2.5).fill(0x222222);
        g.rect(x - 7, y + 8, 14 * Math.max(0, v.hp / maxHp), 2.5).fill(0xef5350);
      }
      if (v.owner === me.id && v.loyalty < 60) {
        g.poly([x + 4, y - 13, x + 9, y - 5, x - 1, y - 5]).fill(v.loyalty < 30 ? 0xff5252 : 0xffa726);
      }
      if (v.order.kind === 'train' && v.path.length === 0) {
        g.rect(x - 8, y - 14, 16, 3).fill(0x222222);
        g.rect(x - 8, y - 14, 16 * v.order.progress, 3).fill(0xffd54f);
      }
      if (v.order.kind === 'explore' && v.path.length === 0) {
        g.rect(x - 8, y - 14, 16, 3).fill(0x222222);
        g.rect(x - 8, y - 14, 16 * v.order.progress, 3).fill(0x4fc3f7);
      }
      if (v.order.kind === 'gather' && v.path.length === 0) {
        g.circle(x + 6, y - 6, 2.5).fill(RESOURCE_COLORS[v.order.resource]);
      }
    }
    for (const [id, t] of this.iconTexts) {
      if (!seen.has(id)) {
        t.destroy();
        this.iconTexts.delete(id);
      }
    }
  }
}
