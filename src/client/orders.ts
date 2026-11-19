import { validateCommand, type Command } from '../sim/commands';
import { hexDistance } from '../sim/hex';
import type { Villager } from '../sim/types';
import type { GameController } from './controller';

export const NO_IDLE = '無空閒單位可用';

/**
 * Give an order to the nearest idle unit that can carry it out, without the
 * player having to select anyone first. `make` builds the command for a unit.
 * Productive work only goes to civilians; exploring may use idle soldiers too
 * (civilians first at equal distance). Returns an error message, or null.
 */
export function withNearestIdle(
  c: GameController,
  tile: number,
  make: (v: Villager) => Command,
  opts: { civiliansOnly?: boolean } = {},
): string | null {
  const s = c.state;
  const me = c.localPlayer;
  const idle = s.villagers
    .filter((v) => v.owner === me && !v.naval && v.order.kind === 'idle' && v.path.length === 0 && !(opts.civiliansOnly && v.soldier))
    .sort((a, b) => hexDistance(s, a.tile, tile) - hexDistance(s, b.tile, tile) || Number(a.soldier) - Number(b.soldier) || a.id - b.id);
  let lastError: string | null = null;
  for (const v of idle) {
    const cmd = make(v);
    lastError = validateCommand(s, cmd);
    if (lastError) continue;
    c.issue(cmd);
    c.select({ villager: v.id, tile });
    return null;
  }
  const error = idle.length === 0 ? NO_IDLE : (lastError ?? NO_IDLE);
  c.lastError = error;
  c.notify();
  return error;
}

/** Explore a tile with the nearest idle unit. */
export function exploreWithNearestIdle(c: GameController, tile: number): string | null {
  return withNearestIdle(c, tile, (v) => ({ type: 'explore', player: v.owner, villager: v.id, tile }));
}

/**
 * Right-click without a selection: the natural job on this tile for the
 * nearest idle unit (explore / help build / work / gather). Null if there is
 * nothing to do here (no message is shown then).
 */
export function quickOrder(c: GameController, tile: number): string | null | undefined {
  const s = c.state;
  const me = s.players[c.localPlayer];
  const land = s.tiles[tile] && me.knowledge !== undefined;
  if (!land) return undefined;
  const building = s.buildings.find((b) => b.tile === tile && b.owner === me.id);
  if (me.knowledge[tile] !== 1) return exploreWithNearestIdle(c, tile);
  if (building) {
    return withNearestIdle(c, tile, (v) => ({ type: 'work', player: me.id, villager: v.id, building: building.id }), { civiliansOnly: true });
  }
  if (s.tiles[tile].deposits.length > 0) {
    return withNearestIdle(c, tile, (v) => ({ type: 'gather', player: me.id, villager: v.id, tile }), { civiliansOnly: true });
  }
  return undefined;
}
