import { applyCommands, createGame, stepGame, type GameSetup } from '../sim/game';
import { validateCommand, type Command } from '../sim/commands';
import { DEFAULT_PORT, HASH_EVERY_FRAMES, type ClientMessage, type LobbyOptions, type ServerMessage } from '../net/protocol';
import { stateHash } from '../net/hash';
import { GameController, type Speed } from './controller';

export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // In development the game is served by Vite, the relay runs separately on DEFAULT_PORT.
  if (import.meta.env.DEV) return `${proto}://${location.hostname || 'localhost'}:${DEFAULT_PORT}`;
  return `${proto}://${location.host}`;
}

export interface LobbyState {
  code: string;
  you: number;
  host: number;
  players: Array<{ id: number; name: string }>;
  options: LobbyOptions;
}

/** Connection to the relay server: lobby first, then a running NetGameController. */
export class NetClient {
  private ws: WebSocket;
  status: 'connecting' | 'open' | 'closed' = 'connecting';
  lobby: LobbyState | null = null;
  error: string | null = null;
  controller: NetGameController | null = null;
  private listeners = new Set<() => void>();
  private pendingOnOpen: ClientMessage[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.status = 'open';
      for (const m of this.pendingOnOpen.splice(0)) this.send(m);
      this.notify();
    };
    this.ws.onclose = () => {
      this.status = 'closed';
      if (!this.error) this.error = '與伺服器的連線中斷了';
      this.notify();
    };
    this.ws.onerror = () => {
      this.error = '無法連線到伺服器';
      this.notify();
    };
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
  }

  send(msg: ClientMessage) {
    if (this.status === 'connecting') this.pendingOnOpen.push(msg);
    else if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  create(name: string) {
    this.send({ t: 'create', name });
  }
  join(code: string, name: string) {
    this.send({ t: 'join', code: code.trim(), name });
  }
  setOptions(options: Partial<LobbyOptions>) {
    this.send({ t: 'options', options });
  }
  start() {
    this.send({ t: 'start' });
  }
  close() {
    this.error = '已離開';
    this.ws.close();
  }

  get isHost(): boolean {
    return !!this.lobby && this.lobby.host === this.lobby.you;
  }

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'lobby':
        this.lobby = { code: msg.code, you: msg.you, host: msg.host, players: msg.players, options: msg.options };
        this.error = null;
        break;
      case 'error':
        this.error = msg.message;
        if (this.controller) this.controller.lastError = msg.message;
        break;
      case 'start':
        this.controller = new NetGameController(this, msg.setup, msg.you, msg.speed as Speed);
        break;
      case 'step':
        this.controller?.onStep(msg.frame, msg.n, msg.cmds);
        return; // the controller notifies its own listeners
      case 'speed':
        if (this.controller) this.controller.speed = msg.speed as Speed;
        break;
      case 'left':
        break;
      case 'desync':
        if (this.controller) this.controller.desync = true;
        break;
    }
    this.notify();
    this.controller?.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    for (const fn of this.listeners) fn();
  }
}

/**
 * Game controller for lockstep multiplayer: local commands go to the server,
 * and the simulation only advances when the server says so.
 */
export class NetGameController extends GameController {
  override readonly isNetwork = true;
  desync = false;

  constructor(
    private client: NetClient,
    setup: GameSetup,
    you: number,
    speed: Speed,
  ) {
    super();
    this.state = createGame(setup);
    this.localPlayer = you;
    this.speed = speed;
  }

  override issue(cmd: Command): string | null {
    const error = validateCommand(this.state, cmd);
    this.lastError = error;
    if (!error) this.client.send({ t: 'cmd', cmd });
    this.notify();
    return error;
  }

  override setSpeed(speed: Speed) {
    this.client.send({ t: 'speed', speed });
  }

  /** Time is driven by the server's steps, not by the local clock. */
  override update() {}

  override newGame() {}

  onStep(frame: number, n: number, cmds: Command[]) {
    const results = n === 0 ? applyCommands(this.state, cmds) : stepGame(this.state, cmds);
    for (let i = 1; i < n; i++) stepGame(this.state);
    const mine = cmds.findIndex((c, i) => c.player === this.localPlayer && results[i] !== null);
    if (mine >= 0) {
      this.lastError = results[mine];
      this.notify();
    }
    if (frame % HASH_EVERY_FRAMES === 0) this.client.send({ t: 'hash', frame, hash: stateHash(this.state) });
  }

  leave() {
    this.client.close();
  }
}
