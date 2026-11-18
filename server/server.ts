/**
 * Multiplayer relay server (lockstep) + optional static hosting of the built game.
 *   node server/server.ts            # PORT=8787, serves ./dist if it exists
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Command } from '../src/sim/commands.ts';
import type { ClientMessage, LobbyOptions, ServerMessage } from '../src/net/protocol.ts';

// Values duplicated from src/net/protocol.ts so this file runs with plain `node`.
const SERVER_FRAME_MS = 100;
const DEFAULT_PORT = 8787;
const MAX_PLAYERS = 4;
const NATIONS = [
  { name: '赤焰王國', color: '#e53935' },
  { name: '藍月王國', color: '#1e88e5' },
  { name: '綠野聯邦', color: '#43a047' },
  { name: '金沙帝國', color: '#fdd835' },
];
const SPEEDS = [0, 1, 2, 5];

interface Client {
  id: number;
  ws: WebSocket;
  name: string;
  room: Room | null;
  player: number;
}

interface Room {
  code: string;
  clients: Client[];
  host: number;
  options: LobbyOptions;
  started: boolean;
  queue: Command[];
  speed: number;
  frame: number;
  timer: ReturnType<typeof setInterval> | null;
  hashes: Map<number, Map<number, string>>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(opts: { port?: number; staticDir?: string; log?: boolean } = {}): Promise<RunningServer> {
  const rooms = new Map<string, Room>();
  let nextClientId = 1;
  const log = (...a: unknown[]) => opts.log && console.log(...a);
  const staticDir = opts.staticDir ? resolve(opts.staticDir) : null;

  const http: Server = createServer(async (req, res) => {
    if (!staticDir) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('SLG multiplayer server is running.');
      return;
    }
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(staticDir, urlPath));
    if (!file.startsWith(staticDir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(staticDir, 'index.html');
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });

  const wss = new WebSocketServer({ server: http });

  const send = (c: Client, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (room: Room, msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of room.clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };
  const lobby = (room: Room) => {
    for (const c of room.clients) {
      send(c, {
        t: 'lobby',
        code: room.code,
        you: c.id,
        host: room.host,
        players: room.clients.map((x) => ({ id: x.id, name: x.name })),
        options: room.options,
      });
    }
  };
  const newCode = () => {
    for (;;) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!rooms.has(code)) return code;
    }
  };

  const startRoom = (room: Room) => {
    const humans = room.clients.length;
    const ai = Math.max(0, Math.min(room.options.aiCount, MAX_PLAYERS - humans));
    const players = [
      ...room.clients.map((c, i) => ({ name: c.name || NATIONS[i].name, color: NATIONS[i].color, isAI: false })),
      ...NATIONS.slice(humans, humans + ai).map((n) => ({ ...n, isAI: true })),
    ];
    room.started = true;
    room.clients.forEach((c, i) => (c.player = i));
    const setup = { seed: room.options.seed, mapSize: room.options.mapSize, players };
    for (const c of room.clients) send(c, { t: 'start', setup, you: c.player, speed: room.speed });
    room.timer = setInterval(() => {
      room.frame++;
      const cmds = room.queue.splice(0);
      broadcast(room, { t: 'step', frame: room.frame, n: room.speed, cmds });
    }, SERVER_FRAME_MS);
    log(`room ${room.code} started with ${humans} players, ${ai} AI`);
  };

  const leave = (c: Client) => {
    const room = c.room;
    if (!room) return;
    room.clients = room.clients.filter((x) => x !== c);
    c.room = null;
    if (room.clients.length === 0) {
      if (room.timer) clearInterval(room.timer);
      rooms.delete(room.code);
      log(`room ${room.code} closed`);
      return;
    }
    if (room.started) {
      // The nation keeps going under AI control.
      room.queue.push({ type: 'playerLeft', player: c.player });
      broadcast(room, { t: 'left', name: c.name });
    } else {
      if (room.host === c.id) room.host = room.clients[0].id;
      lobby(room);
    }
  };

  wss.on('connection', (ws) => {
    const client: Client = { id: nextClientId++, ws, name: '', room: null, player: -1 };
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return send(client, { t: 'error', message: '無法解析訊息' });
      }
      const room = client.room;
      switch (msg.t) {
        case 'create': {
          if (room) return send(client, { t: 'error', message: '已經在房間裡了' });
          const r: Room = {
            code: newCode(),
            clients: [client],
            host: client.id,
            options: { seed: Math.floor(Math.random() * 2 ** 31), mapSize: 'medium', aiCount: 1 },
            started: false,
            queue: [],
            speed: 1,
            frame: 0,
            timer: null,
            hashes: new Map(),
          };
          client.name = String(msg.name ?? '').slice(0, 16);
          client.room = r;
          rooms.set(r.code, r);
          lobby(r);
          return;
        }
        case 'join': {
          const r = rooms.get(String(msg.code));
          if (!r) return send(client, { t: 'error', message: '找不到這個房間' });
          if (r.started) return send(client, { t: 'error', message: '遊戲已經開始了' });
          if (r.clients.length >= MAX_PLAYERS) return send(client, { t: 'error', message: '房間已滿' });
          client.name = String(msg.name ?? '').slice(0, 16);
          client.room = r;
          r.clients.push(client);
          lobby(r);
          return;
        }
        case 'options': {
          if (!room || room.started) return;
          if (room.host !== client.id) return send(client, { t: 'error', message: '只有房主可以修改設定' });
          const o = msg.options;
          if (typeof o.seed === 'number') room.options.seed = o.seed | 0;
          if (typeof o.mapSize === 'string') room.options.mapSize = o.mapSize;
          if (typeof o.aiCount === 'number') room.options.aiCount = Math.max(0, Math.min(MAX_PLAYERS - 1, o.aiCount | 0));
          lobby(room);
          return;
        }
        case 'start': {
          if (!room || room.started) return;
          if (room.host !== client.id) return send(client, { t: 'error', message: '只有房主可以開始遊戲' });
          startRoom(room);
          return;
        }
        case 'cmd': {
          if (!room || !room.started) return;
          const cmd = msg.cmd;
          // Players may only command their own nation; system commands come from the server.
          if (!cmd || cmd.player !== client.player || cmd.type === 'playerLeft') {
            return send(client, { t: 'error', message: '無效的指令' });
          }
          room.queue.push(cmd);
          return;
        }
        case 'speed': {
          if (!room || !room.started || !SPEEDS.includes(msg.speed)) return;
          room.speed = msg.speed;
          broadcast(room, { t: 'speed', speed: room.speed });
          return;
        }
        case 'hash': {
          if (!room || !room.started) return;
          const at = room.hashes.get(msg.frame) ?? new Map<number, string>();
          at.set(client.player, String(msg.hash));
          room.hashes.set(msg.frame, at);
          if (at.size === room.clients.length) {
            if (new Set(at.values()).size > 1) {
              log(`room ${room.code} desync at frame ${msg.frame}`);
              broadcast(room, { t: 'desync', frame: msg.frame });
            }
            room.hashes.delete(msg.frame);
          }
          return;
        }
      }
    });
    ws.on('close', () => leave(client));
  });

  return new Promise((resolvePromise) => {
    http.listen(opts.port ?? DEFAULT_PORT, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : (opts.port ?? DEFAULT_PORT);
      resolvePromise({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const r of rooms.values()) if (r.timer) clearInterval(r.timer);
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

// Run directly: node server/server.ts
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const dist = resolve('dist');
  stat(dist)
    .then(() => dist)
    .catch(() => undefined)
    .then((staticDir) => startServer({ port, staticDir, log: true }))
    .then((s) => console.log(`SLG server on http://localhost:${s.port}${'' /* ws on the same port */}`));
}
