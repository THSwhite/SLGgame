import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../server/server';
import { applyCommands, createGame, stepGame, type GameSetup } from '../src/sim/game';
import { stateHash } from '../src/net/hash';
import { TERRAIN } from '../src/sim/data';
import { hexDistance, tilesInRadius } from '../src/sim/hex';
import type { ServerMessage } from '../src/net/protocol';
import type { GameState } from '../src/sim/types';

/** Minimal headless client: records messages and runs its own copy of the simulation. */
class Peer {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  state: GameState | null = null;
  you = -1;
  frames = 0;
  hashes = new Map<number, string>();
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}`);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      this.inbox.push(msg);
      if (msg.t === 'start') {
        this.state = createGame(msg.setup as GameSetup);
        this.you = msg.you;
      } else if (msg.t === 'step' && this.state) {
        if (msg.n === 0) applyCommands(this.state, msg.cmds);
        else stepGame(this.state, msg.cmds);
        for (let i = 1; i < msg.n; i++) stepGame(this.state);
        this.frames = msg.frame;
        this.hashes.set(msg.frame, stateHash(this.state));
      }
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once('open', () => r()));
  }
  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }
  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    for (let i = 0; i < 200; i++) {
      const m = this.inbox.find((x) => x.t === t && pred(x as Extract<ServerMessage, { t: T }>));
      if (m) return m as Extract<ServerMessage, { t: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting for ${t}`);
  }
  async waitFrame(frame: number) {
    for (let i = 0; i < 500 && this.frames < frame; i++) await new Promise((r) => setTimeout(r, 20));
  }
}

let server: RunningServer | null = null;
const peers: Peer[] = [];
afterEach(async () => {
  for (const p of peers.splice(0)) p.ws.close();
  await server?.close();
  server = null;
});

async function room(n: number, aiCount = 0) {
  server = await startServer({ port: 0 });
  const host = new Peer(server.port);
  peers.push(host);
  await host.open();
  host.send({ t: 'create', name: '房主' });
  const lobby = await host.waitFor('lobby');
  host.send({ t: 'options', options: { seed: 12345, aiCount } });
  for (let i = 1; i < n; i++) {
    const p = new Peer(server.port);
    peers.push(p);
    await p.open();
    p.send({ t: 'join', code: lobby.code, name: `玩家${i}` });
    await p.waitFor('lobby', (m) => m.players.length === i + 1);
  }
  return { host, code: lobby.code };
}

function goodStarts(s: GameState, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.tiles.length && out.length < count; i++) {
    const ring = tilesInRadius(s, i, 2);
    if (ring.length !== 19 || !ring.every((t) => TERRAIN[s.tiles[t].terrain].land)) continue;
    if (out.some((t) => Math.abs((t % s.width) - (i % s.width)) + Math.abs(Math.floor(t / s.width) - Math.floor(i / s.width)) < 16)) continue;
    out.push(i);
  }
  return out;
}

describe('multiplayer relay', () => {
  it('lobby: create, join, host-only options', async () => {
    const { host } = await room(2);
    const guest = peers[1];
    guest.send({ t: 'options', options: { aiCount: 3 } });
    const err = await guest.waitFor('error');
    expect(err.message).toMatch(/房主/);
    const lobby = await host.waitFor('lobby', (m) => m.players.length === 2);
    expect(lobby.players.map((p) => p.name)).toEqual(['房主', '玩家1']);
  });

  it('keeps two clients in lockstep, including AI', async () => {
    const { host } = await room(2, 1);
    const guest = peers[1];
    host.send({ t: 'start' });
    await host.waitFor('start');
    await guest.waitFor('start');
    expect([host.you, guest.you]).toEqual([0, 1]);
    expect(host.state!.players.map((p) => p.isAI)).toEqual([false, false, true]);

    const [a, b] = goodStarts(host.state!, 2);
    host.send({ t: 'cmd', cmd: { type: 'chooseStart', player: 0, tile: a } });
    guest.send({ t: 'cmd', cmd: { type: 'chooseStart', player: 1, tile: b } });
    host.send({ t: 'speed', speed: 5 });
    await host.waitFrame(30);
    await guest.waitFrame(30);
    expect(host.state!.phase).toBe('playing');
    const v = host.state!.villagers.find((x) => x.owner === 0)!;
    const hs = host.state!;
    const target = hs.tiles.findIndex((t, i) => TERRAIN[t.terrain].land && hs.players[0].knowledge[i] === 0 && hexDistance(hs, i, a) === 3);
    host.send({ t: 'cmd', cmd: { type: 'explore', player: 0, villager: v.id, tile: target } });
    const until = host.frames + 40;
    await host.waitFrame(until);
    await guest.waitFrame(until);
    expect(host.state!.tick).toBeGreaterThan(100);
    // Same frame, same state, on every frame both have seen.
    let compared = 0;
    for (const [frame, h] of host.hashes) {
      const g = guest.hashes.get(frame);
      if (g !== undefined) {
        expect(g).toBe(h);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(50);
    expect(host.state!.players[0].knowledge[target]).toBe(1);
  }, 30000);

  it('rejects commands for another player', async () => {
    const { host } = await room(2);
    const guest = peers[1];
    host.send({ t: 'start' });
    await guest.waitFor('start');
    guest.send({ t: 'cmd', cmd: { type: 'setResearch', player: 0, research: 'tools' } });
    const err = await guest.waitFor('error');
    expect(err.message).toBe('無效的指令');
  });

  it('hands a disconnected player over to the AI', async () => {
    const { host } = await room(2);
    const guest = peers[1];
    host.send({ t: 'start' });
    await host.waitFor('start');
    await guest.waitFor('start');
    guest.ws.close();
    await host.waitFor('step', (m) => m.cmds.some((c) => c.type === 'playerLeft'));
    await new Promise((r) => setTimeout(r, 50));
    expect(host.state!.players[1].isAI).toBe(true);
  });
});
