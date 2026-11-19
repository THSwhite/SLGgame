import { validateCommand } from '../sim/commands';
import { hexDistance } from '../sim/hex';
import type { GameController } from './controller';

/**
 * Explore a tile with the nearest idle unit that can get there (civilians
 * before soldiers at equal distance). Returns an error message, or null.
 */
export function exploreWithNearestIdle(c: GameController, tile: number): string | null {
  const s = c.state;
  const me = c.localPlayer;
  const idle = s.villagers
    .filter((v) => v.owner === me && !v.naval && v.order.kind === 'idle' && v.path.length === 0)
    .sort((a, b) => hexDistance(s, a.tile, tile) - hexDistance(s, b.tile, tile) || Number(a.soldier) - Number(b.soldier) || a.id - b.id);
  let lastError: string | null = null;
  for (const v of idle) {
    const cmd = { type: 'explore', player: me, villager: v.id, tile } as const;
    lastError = validateCommand(s, cmd);
    if (lastError) continue;
    c.issue(cmd);
    c.select({ villager: v.id, tile });
    return null;
  }
  const error = idle.length === 0 ? '無空閒單位可用' : (lastError ?? '無空閒單位可用');
  c.lastError = error;
  c.notify();
  return error;
}
