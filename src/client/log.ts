import type { GameEvent, GameState, PlayerId } from '../sim/types';

export interface LogEntry {
  id: number;
  tick: number;
  kind: 'event' | 'chat';
  /** For chat: the nation that spoke. */
  from?: PlayerId;
  text: string;
}

/** Keeps more history than state.events (which is capped) and holds chat messages. Client-only. */
export const MAX_LOG = 500;
export const MAX_CHAT_LENGTH = 120;

export class MessageLog {
  entries: LogEntry[] = [];
  private seen = new WeakSet<GameEvent>();
  private nextId = 1;

  /** Pull new events for `player` from the simulation. */
  sync(state: GameState, player: PlayerId): void {
    const fresh: GameEvent[] = [];
    for (let i = state.events.length - 1; i >= 0; i--) {
      const e = state.events[i];
      if (this.seen.has(e)) break;
      this.seen.add(e);
      if (e.player === player) fresh.push(e);
    }
    for (const e of fresh.reverse()) this.push({ tick: e.tick, kind: 'event', text: e.message });
  }

  addChat(tick: number, from: PlayerId, text: string): void {
    this.push({ tick, kind: 'chat', from, text });
  }

  private push(e: Omit<LogEntry, 'id'>) {
    this.entries.push({ ...e, id: this.nextId++ });
    if (this.entries.length > MAX_LOG) this.entries.splice(0, this.entries.length - MAX_LOG);
  }
}

export function cleanChat(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
}
