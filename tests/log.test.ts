import { describe, expect, it } from 'vitest';
import { MessageLog, MAX_LOG, cleanChat } from '../src/client/log';
import { logEvent } from '../src/sim/state';
import { startAt } from './helpers';

describe('message log', () => {
  it('collects only this player’s events, once, in order, beyond the sim cap', () => {
    const s = startAt(undefined, 2);
    const log = new MessageLog();
    log.sync(s, 0);
    const base = log.entries.length;
    for (let i = 0; i < 150; i++) {
      logEvent(s, 0, `e${i}`);
      logEvent(s, 1, `other${i}`);
      log.sync(s, 0);
    }
    log.sync(s, 0);
    const mine = log.entries.slice(base).map((e) => e.text);
    expect(mine).toEqual(Array.from({ length: 150 }, (_, i) => `e${i}`));
    expect(log.entries.every((e) => e.kind === 'event')).toBe(true);
  });

  it('holds chat and keeps at most MAX_LOG entries', () => {
    const log = new MessageLog();
    for (let i = 0; i < MAX_LOG + 20; i++) log.addChat(i, 0, `m${i}`);
    expect(log.entries).toHaveLength(MAX_LOG);
    expect(log.entries.at(-1)).toMatchObject({ kind: 'chat', from: 0, text: `m${MAX_LOG + 19}` });
  });

  it('cleans chat text', () => {
    expect(cleanChat('  a \n  b ')).toBe('a b');
    expect(cleanChat('   ')).toBe('');
  });
});
