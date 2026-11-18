import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameController, SPEEDS, type Speed } from '../client/controller';
import { MapRenderer } from '../client/renderer';
import { BALANCE, RESOURCE_NAMES, RESOURCE_TYPES, TERRAIN } from '../sim/data';
import { foodConsumptionPerMinute } from '../sim/systems/food';
import { Knowledge, type GameState } from '../sim/types';
import { formatTime, terrainLabel, tileLabel, villagerStatus } from './describe';

const SPEED_LABEL: Record<Speed, string> = { 0: '⏸', 1: '1×', 2: '2×', 5: '5×' };

/** Pick the default order for a right-click on a tile. */
function smartCommand(c: GameController, tile: number) {
  const s = c.state;
  const vid = c.selection.villager;
  if (vid === null) return;
  const me = s.players[c.localPlayer];
  if (!TERRAIN[s.tiles[tile].terrain].land) {
    c.lastError = '只能前往陸地';
    c.notify();
    return;
  }
  if (me.knowledge[tile] !== Knowledge.Explored) c.issue({ type: 'explore', player: me.id, villager: vid, tile });
  else if (s.tiles[tile].deposits.length > 0) c.issue({ type: 'gather', player: me.id, villager: vid, tile });
  else c.issue({ type: 'move', player: me.id, villager: vid, tile });
}

export function App() {
  const [controller] = useState(() => new GameController());
  if (import.meta.env.DEV) (window as unknown as { __game: GameController }).__game = controller;
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const unsub = controller.subscribe(refresh);
    const timer = setInterval(refresh, 200);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [controller]);

  const onTileClick = useCallback(
    (tile: number, button: 'left' | 'right') => {
      const s = controller.state;
      if (s.phase === 'choosingStart') {
        controller.select({ tile });
        return;
      }
      if (button === 'right') {
        smartCommand(controller, tile);
        return;
      }
      const here = s.villagers.filter((v) => v.owner === controller.localPlayer && v.tile === tile);
      if (here.length > 0) {
        // Cycle through villagers standing on the tile.
        const idx = here.findIndex((v) => v.id === controller.selection.villager);
        controller.select({ tile, villager: here[(idx + 1) % here.length].id });
      } else {
        controller.select({ tile });
      }
    },
    [controller],
  );

  useEffect(() => {
    const r = new MapRenderer(controller, { onTileClick });
    rendererRef.current = r;
    r.mount(hostRef.current!);
    return () => r.destroy();
  }, [controller, onTileClick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        controller.setSpeed(controller.speed === 0 ? 1 : 0);
      } else if (e.key === '1') controller.setSpeed(1);
      else if (e.key === '2') controller.setSpeed(2);
      else if (e.key === '3') controller.setSpeed(5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  const s = controller.state;
  const me = s.players[controller.localPlayer];

  return (
    <div className="app">
      <div className="map" ref={hostRef} />
      {s.phase === 'choosingStart' ? (
        <StartOverlay controller={controller} onStarted={(t) => rendererRef.current?.centerOn(t)} />
      ) : (
        <>
          <TopBar controller={controller} state={s} />
          <VillagerPanel controller={controller} state={s} onFocus={(t) => rendererRef.current?.centerOn(t)} />
          <TilePanel controller={controller} state={s} />
          <EventLog state={s} playerId={me.id} />
        </>
      )}
    </div>
  );
}

function StartOverlay({ controller, onStarted }: { controller: GameController; onStarted: (t: number) => void }) {
  const s = controller.state;
  const tile = controller.selection.tile;
  const land = tile !== null && TERRAIN[s.tiles[tile].terrain].land;
  return (
    <div className="panel start-panel">
      <h2>選擇起點</h2>
      <p>你只知道哪裡是陸地、哪裡是海洋。點選一塊陸地作為國家的起點。</p>
      <p className="hint">拖曳平移地圖，滾輪縮放</p>
      <div className="row">
        <span>{tile === null ? '尚未選擇' : land ? `已選擇 (${tileLabel(s, tile)})` : '這裡是水域，請選擇陸地'}</span>
        <button
          disabled={!land}
          onClick={() => {
            const err = controller.issue({ type: 'chooseStart', player: controller.localPlayer, tile: tile! });
            if (!err) {
              controller.select({ tile: null, villager: s.villagers.find((v) => v.owner === controller.localPlayer)?.id ?? null });
              onStarted(tile!);
            }
          }}
        >
          在此建國
        </button>
      </div>
      {controller.lastError && <div className="error">{controller.lastError}</div>}
    </div>
  );
}

function TopBar({ controller, state }: { controller: GameController; state: GameState }) {
  const me = state.players[controller.localPlayer];
  const consumption = foodConsumptionPerMinute(state, me);
  return (
    <div className="panel topbar">
      {RESOURCE_TYPES.map((r) => (
        <div key={r} className={`res res-${r}`}>
          <span className="res-name">{RESOURCE_NAMES[r]}</span>
          <span className="res-val">{Math.floor(me.stock[r])}</span>
          {r === 'food' && <span className="res-delta">-{consumption.toFixed(1)}/分</span>}
        </div>
      ))}
      <div className="spacer" />
      <div className="clock">⏱ {formatTime(state.tick)}</div>
      <div className="speeds">
        {SPEEDS.map((sp) => (
          <button key={sp} className={controller.speed === sp ? 'active' : ''} onClick={() => controller.setSpeed(sp)}>
            {SPEED_LABEL[sp]}
          </button>
        ))}
      </div>
    </div>
  );
}

function VillagerPanel({
  controller,
  state,
  onFocus,
}: {
  controller: GameController;
  state: GameState;
  onFocus: (tile: number) => void;
}) {
  const mine = state.villagers.filter((v) => v.owner === controller.localPlayer);
  const idle = mine.filter((v) => v.order.kind === 'idle');
  return (
    <div className="panel villagers">
      <div className="panel-title">
        村民 {mine.length}
        <button
          disabled={idle.length === 0}
          onClick={() => {
            const cur = idle.findIndex((v) => v.id === controller.selection.villager);
            const next = idle[(cur + 1) % idle.length];
            controller.select({ villager: next.id, tile: next.tile });
            onFocus(next.tile);
          }}
        >
          下一位閒置（{idle.length}）
        </button>
      </div>
      {mine.map((v) => (
        <div
          key={v.id}
          className={`villager ${controller.selection.villager === v.id ? 'selected' : ''} ${v.order.kind === 'idle' ? 'idle' : ''}`}
          onClick={() => controller.select({ villager: v.id })}
          onDoubleClick={() => onFocus(v.tile)}
        >
          <span>
            #{v.id} <small>LV{v.level}</small>
          </span>
          <span className="status">{villagerStatus(state, v)}</span>
        </div>
      ))}
      <div className="hint">
        左鍵：選取 ／ 右鍵：對選取的村民下指令（未探索→探索、有資源→採集、其他→移動）
        <br />
        空白鍵：暫停 ／ 1 2 3：速度
      </div>
    </div>
  );
}

function TilePanel({ controller, state }: { controller: GameController; state: GameState }) {
  const tile = controller.selection.tile;
  const vid = controller.selection.villager;
  const me = state.players[controller.localPlayer];
  if (tile === null) {
    return controller.lastError ? <div className="panel tile-panel error">{controller.lastError}</div> : null;
  }
  const t = state.tiles[tile];
  const def = TERRAIN[t.terrain];
  const explored = me.knowledge[tile] === Knowledge.Explored;
  const owner = t.owner === -1 ? '無主之地' : state.players[t.owner].name;
  const villager = state.villagers.find((v) => v.id === vid);

  return (
    <div className="panel tile-panel">
      <div className="panel-title">
        {terrainLabel(state, me.id, tile)} <small>({tileLabel(state, tile)})</small>
      </div>
      {def.land && <div>領土：{owner}</div>}
      {def.land && explored && (
        <>
          <div>
            移動耗費 ×{def.moveCost}　{def.farmable ? '可耕作' : '不可耕作'}
          </div>
          <div>
            資源：
            {t.deposits.length === 0
              ? '無'
              : t.deposits.map((d) => `${RESOURCE_NAMES[d.resource]} ${Math.ceil(d.amount)}`).join('、')}
          </div>
        </>
      )}
      {def.land && !explored && <div className="hint">需要派村民探索（{BALANCE.exploreSeconds} 秒）才能得知資源。</div>}
      {villager && def.land && (
        <div className="actions">
          <div className="hint">對村民 #{villager.id} 下令：</div>
          {!explored && (
            <button onClick={() => controller.issue({ type: 'explore', player: me.id, villager: villager.id, tile })}>探索</button>
          )}
          {explored &&
            t.deposits.map((d) => (
              <button
                key={d.resource}
                onClick={() =>
                  controller.issue({ type: 'gather', player: me.id, villager: villager.id, tile, resource: d.resource })
                }
              >
                採集{RESOURCE_NAMES[d.resource]}
              </button>
            ))}
          <button onClick={() => controller.issue({ type: 'move', player: me.id, villager: villager.id, tile })}>移動</button>
          {villager.order.kind !== 'idle' && (
            <button onClick={() => controller.issue({ type: 'stop', player: me.id, villager: villager.id })}>停止</button>
          )}
        </div>
      )}
      {controller.lastError && <div className="error">{controller.lastError}</div>}
    </div>
  );
}

function EventLog({ state, playerId }: { state: GameState; playerId: number }) {
  const events = state.events.filter((e) => e.player === playerId).slice(-6).reverse();
  if (events.length === 0) return null;
  return (
    <div className="panel events">
      {events.map((e, i) => (
        <div key={`${e.tick}-${i}`}>
          <span className="time">{formatTime(e.tick)}</span> {e.message}
        </div>
      ))}
    </div>
  );
}
