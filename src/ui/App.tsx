import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameController, SPEEDS, type Speed } from '../client/controller';
import { MapRenderer } from '../client/renderer';
import { BALANCE, BUILDING_TYPES, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES, TERRAIN, type ResourceType } from '../sim/data';
import { validateCommand } from '../sim/commands';
import { buildingRatePerWorker, hasFreshWaterNearby, incomePerMinute, workersAt } from '../sim/economy';
import { foodConsumptionPerMinute } from '../sim/systems/food';
import { populationBlocked, populationCap, populationCount } from '../sim/systems/population';
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
  const building = s.buildings.find((b) => b.tile === tile && b.owner === me.id);
  if (building && (building.progress < 1 || BUILDINGS[building.type].workerSlots > 0)) {
    c.issue({ type: 'work', player: me.id, villager: vid, building: building.id });
  } else if (me.knowledge[tile] !== Knowledge.Explored) c.issue({ type: 'explore', player: me.id, villager: vid, tile });
  else if (s.tiles[tile].deposits.length > 0) c.issue({ type: 'gather', player: me.id, villager: vid, tile });
  else c.issue({ type: 'move', player: me.id, villager: vid, tile });
}

export function App() {
  const [controller] = useState(() => new GameController());
  if (import.meta.env.DEV) (window as unknown as { __game: GameController }).__game = controller;
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [showManagement, setShowManagement] = useState(false);

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
      else if (e.key === 'm' || e.key === 'M') setShowManagement((x) => !x);
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
          <TopBar controller={controller} state={s} onManagement={() => setShowManagement((x) => !x)} />
          {showManagement && <ManagementPanel controller={controller} state={s} onClose={() => setShowManagement(false)} />}
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

function fmtRate(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}/分`;
}

function TopBar({ controller, state, onManagement }: { controller: GameController; state: GameState; onManagement: () => void }) {
  const me = state.players[controller.localPlayer];
  const income = incomePerMinute(state, me);
  const net: Record<ResourceType, number> = { ...income, food: income.food - foodConsumptionPerMinute(state, me) };
  return (
    <div className="panel topbar">
      <div className="res">
        <span className="res-name">人口</span>
        <span className="res-val">
          {populationCount(state, me)}/{populationCap(state, me)}
        </span>
      </div>
      {RESOURCE_TYPES.map((r) => (
        <div key={r} className={`res res-${r}`}>
          <span className="res-name">{RESOURCE_NAMES[r]}</span>
          <span className="res-val">{Math.floor(me.stock[r])}</span>
          {(net[r] !== 0 || r === 'food') && (
            <span className={`res-delta ${net[r] < 0 ? 'neg' : 'pos'}`}>{fmtRate(net[r])}</span>
          )}
        </div>
      ))}
      <button onClick={onManagement}>管理 (M)</button>
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

function ManagementPanel({ controller, state, onClose }: { controller: GameController; state: GameState; onClose: () => void }) {
  const me = state.players[controller.localPlayer];
  const m = me.management;
  const pop = BALANCE.population;
  const blocked = populationBlocked(state, me);
  const progress = Math.min(1, me.popProgress / (m.popIntervalSeconds * BALANCE.ticksPerSecond));
  const set = (settings: Partial<typeof m>) => controller.issue({ type: 'setManagement', player: me.id, settings });
  const houses = state.buildings.filter((b) => b.owner === me.id && b.type === 'house' && b.progress >= 1).length;
  const consumption = foodConsumptionPerMinute(state, me);
  const income = incomePerMinute(state, me).food;
  return (
    <div className="panel management">
      <div className="panel-title">
        國家管理
        <button onClick={onClose}>✕</button>
      </div>
      <h3>人口生產</h3>
      <label className="check">
        <input type="checkbox" checked={m.popEnabled} onChange={(e) => set({ popEnabled: e.target.checked })} />
        生產人口
      </label>
      <label className="slider">
        生產速度：每 <b>{m.popIntervalSeconds}</b> 秒 1 人
        <input
          type="range"
          min={pop.minIntervalSeconds}
          max={pop.maxIntervalSeconds}
          step={5}
          value={m.popIntervalSeconds}
          onChange={(e) => set({ popIntervalSeconds: Number(e.target.value) })}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={m.foodProtection} onChange={(e) => set({ foodProtection: e.target.checked })} />
        糧食保護（糧食收入不夠養活新人口時暫停生產）
      </label>
      <div className="progress">
        <div className="bar" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className={blocked ? 'error' : 'hint'}>{blocked ?? `下一位村民：${Math.ceil((1 - progress) * m.popIntervalSeconds)} 秒`}</div>
      <div className="hint">
        每位新村民消耗糧食 {pop.foodCostPerVillager}。人口上限 {populationCap(state, me)} = 營地 {BUILDINGS.camp.popCap} + 民宅 {houses} ×{' '}
        {BUILDINGS.house.popCap}
      </div>
      <h3>糧食</h3>
      <div>
        收入 {fmtRate(income)}　消耗 {fmtRate(-consumption)}　淨值{' '}
        <b className={income - consumption < 0 ? 'neg' : 'pos'}>{fmtRate(income - consumption)}</b>
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
        左鍵：選取 ／ 右鍵：對選取的村民下指令（自己的建築→建造或工作、未探索→探索、有資源→採集、其他→移動）
        <br />
        空白鍵：暫停 ／ 1 2 3：速度 ／ M：管理
      </div>
    </div>
  );
}

function costText(cost: Partial<Record<ResourceType, number>>): string {
  return RESOURCE_TYPES.filter((r) => cost[r]).map((r) => `${RESOURCE_NAMES[r]}${cost[r]}`).join(' ');
}

function BuildingInfo({ controller, state, tile }: { controller: GameController; state: GameState; tile: number }) {
  const b = state.buildings.find((x) => x.tile === tile);
  if (!b) return null;
  const def = BUILDINGS[b.type];
  const owner = state.players[b.owner];
  const mine = b.owner === controller.localPlayer;
  const workers = workersAt(state, b.id);
  const rates = buildingRatePerWorker(state, b);
  const vid = controller.selection.villager;
  return (
    <div className="building-info">
      <div className="panel-title">
        {def.name} <small>{mine ? '' : owner.name}</small>
      </div>
      {b.progress < 1 ? (
        <div>建造中 {Math.floor(b.progress * 100)}%</div>
      ) : (
        <>
          {def.popCap > 0 && <div>人口上限 +{def.popCap}</div>}
          {def.territoryRadius > 0 && <div>國土半徑 {def.territoryRadius}</div>}
          {def.workerSlots > 0 && (
            <div>
              工作人員 {workers.length}/{def.workerSlots}　每人產量：
              {RESOURCE_TYPES.filter((r) => rates[r] > 0)
                .map((r) => `${RESOURCE_NAMES[r]} ${(rates[r] * 60).toFixed(1)}/分`)
                .join('、') || '無'}
            </div>
          )}
          {b.type === 'farm' && hasFreshWaterNearby(state, b.tile) && <div className="pos">鄰近淡水：產量 +{(def.freshWaterBonus ?? 0) * 100}%</div>}
          {b.type === 'mine' && state.tiles[b.tile].terrain !== 'stone' && <div className="neg">不在石地上：產量極低</div>}
        </>
      )}
      {mine && vid !== null && (b.progress < 1 || def.workerSlots > 0) && (
        <div className="actions">
          <button onClick={() => controller.issue({ type: 'work', player: controller.localPlayer, villager: vid, building: b.id })}>
            {b.progress < 1 ? `派村民 #${vid} 協助建造` : `派村民 #${vid} 來工作`}
          </button>
        </div>
      )}
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
  const hasBuilding = state.buildings.some((b) => b.tile === tile);

  return (
    <div className="panel tile-panel">
      <div className="panel-title">
        {terrainLabel(state, me.id, tile)} <small>({tileLabel(state, tile)})</small>
      </div>
      {def.land && <div>國土：{owner}</div>}
      {def.land && explored && (
        <>
          <div>
            移動耗費 ×{def.moveCost}　{def.farmable ? '可耕作' : '不可耕作'}
            {hasFreshWaterNearby(state, tile) && '　鄰近淡水'}
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
      <BuildingInfo controller={controller} state={state} tile={tile} />
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
      {villager && def.land && explored && !hasBuilding && (
        <div className="build-menu">
          <div className="hint">建造：</div>
          {BUILDING_TYPES.filter((type) => BUILDINGS[type].buildable).map((type) => {
            const cmd = { type: 'placeBuilding', player: me.id, villager: villager.id, tile, building: type } as const;
            const err = validateCommand(state, cmd);
            return (
              <div key={type} className="build-row">
                <button disabled={err !== null} onClick={() => controller.issue(cmd)}>
                  {BUILDINGS[type].name}
                </button>
                <span className="cost">{costText(BUILDINGS[type].cost)}</span>
                {err && <span className="reason">{err}</span>}
              </div>
            );
          })}
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
