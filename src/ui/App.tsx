import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { GameController, MAX_AI, randomSeed, SPEEDS, type Speed } from '../client/controller';
import { MapRenderer } from '../client/renderer';
import { BALANCE, BUILDING_TYPES, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES, TERRAIN, type ResourceType } from '../sim/data';
import { validateCommand } from '../sim/commands';
import {
  adjacentForests,
  buildingRatePerWorker,
  hasFreshWaterNearby,
  incomePerMinute,
  researchPerMinute,
  researchRatePerWorker,
  workersAt,
} from '../sim/economy';
import { garrisonOf } from '../sim/systems/territory';
import { enemiesOnTile } from '../sim/systems/combat';
import { cityCount, cityLimit, distanceToCapital, independenceChance, independenceThreshold, lacksWorkforce, villagersNearby } from '../sim/systems/cities';
import { getRelation } from '../sim/systems/diplomacy';
import { EndOverlay } from './EndOverlay';
import { StorePanel } from './StorePanel';
import { storageCapacity, storesOf } from '../sim/storage';
import { useGameAudio, SoundButton } from './Sound';
import { ChatLog } from './ChatLog';
import type { NetGameController } from '../client/net';
import { ResearchPanel } from './ResearchPanel';
import { DiplomacyPanel, pendingProposals } from './DiplomacyPanel';
import { foodConsumptionPerMinute } from '../sim/systems/food';
import { populationBlocked, populationCap, populationCount } from '../sim/systems/population';
import { Knowledge, type GameState } from '../sim/types';
import { activityIcon, formatTime, terrainLabel, tileLabel, villagerStatus } from './describe';

const SPEED_LABEL: Record<Speed, string> = { 0: '⏸', 1: '1×', 2: '2×', 5: '5×' };

/** Pick the default order for one villager right-clicking a tile. */
function smartOne(c: GameController, vid: number, tile: number): string | null {
  const s = c.state;
  const me = s.players[c.localPlayer];
  const villager = s.villagers.find((v) => v.id === vid);
  if (!villager) return null;
  const building = s.buildings.find((b) => b.tile === tile && b.owner === me.id);
  const def = building ? BUILDINGS[building.type] : null;
  const p = me.id;
  if (villager.naval) {
    const { villagers } = enemiesOnTile(s, me.id, tile);
    if (villagers.length) return c.issue({ type: 'attack', player: p, villager: vid, tile });
    return c.issue({ type: 'move', player: p, villager: vid, tile });
  }
  if (villager.soldier) {
    const { villagers, buildings } = enemiesOnTile(s, me.id, tile);
    const owner = s.tiles[tile].owner;
    const hostileLand = owner !== -1 && owner !== me.id && getRelation(s, me.id, owner).status === 'war';
    if (villagers.length || buildings.length || hostileLand) return c.issue({ type: 'attack', player: p, villager: vid, tile });
  }
  if (building && def && building.progress >= 1 && def.garrisonSlots > 0 && villager.soldier) {
    return c.issue({ type: 'garrison', player: p, villager: vid, building: building.id });
  }
  if (building && def && building.progress >= 1 && def.trainingSlots > 0 && !villager.soldier) {
    return c.issue({ type: 'train', player: p, villager: vid, building: building.id });
  }
  if (building && def && !villager.soldier && (building.progress < 1 || def.workerSlots > 0)) {
    return c.issue({ type: 'work', player: p, villager: vid, building: building.id });
  }
  if (me.knowledge[tile] !== Knowledge.Explored) return c.issue({ type: 'explore', player: p, villager: vid, tile });
  if (s.tiles[tile].deposits.length > 0 && !villager.soldier) return c.issue({ type: 'gather', player: p, villager: vid, tile });
  return c.issue({ type: 'move', player: p, villager: vid, tile });
}

/** Right-click: give every selected villager a sensible order for the tile. */
function smartCommand(c: GameController, tile: number) {
  const targets = c.orderTargets;
  if (targets.length === 0) return;
  const water = !TERRAIN[c.state.tiles[tile].terrain].land;
  const errors = targets
    .map((id) => {
      const v = c.state.villagers.find((x) => x.id === id);
      // Only navy can be ordered onto the water.
      if (water && !v?.naval) return '只能前往陸地（要渡海請把目的地設在對岸，並先建造港口）';
      return smartOne(c, id, tile);
    })
    .filter((e): e is string => e !== null);
  if (errors.length) {
    c.lastError = errors[0];
    c.notify();
  }
}

export function Game({ controller, onExit }: { controller: GameController; onExit: () => void }) {
  if (import.meta.env.DEV) (window as unknown as { __game: GameController }).__game = controller;
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const [showManagement, setShowManagement] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [showDiplomacy, setShowDiplomacy] = useState(false);
  useGameAudio(controller);

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
      // Don't steal keys while the player is typing.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === ' ') {
        e.preventDefault();
        controller.setSpeed(controller.speed === 0 ? 1 : 0);
      } else if (e.key === '1') controller.setSpeed(1);
      else if (e.key === '2') controller.setSpeed(2);
      else if (e.key === '3') controller.setSpeed(5);
      else if (e.key === 'm' || e.key === 'M') setShowManagement((x) => !x);
      else if (e.key === 'r' || e.key === 'R') setShowResearch((x) => !x);
      else if (e.key === 'd' || e.key === 'D') setShowDiplomacy((x) => !x);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  const s = controller.state;

  return (
    <div className="app">
      <div className="map" ref={hostRef} />
      {s.phase === 'ended' && <EndOverlay controller={controller} state={s} />}
      {controller.isNetwork && (controller as NetGameController).desync && (
        <div className="panel desync">⚠ 偵測到與其他玩家的遊戲狀態不同步。請回報這個問題。</div>
      )}
      {s.phase === 'choosingStart' ? (
        <StartOverlay controller={controller} onStarted={(t) => rendererRef.current?.centerOn(t)} />
      ) : (
        <>
          <TopBar
            controller={controller}
            state={s}
            onManagement={() => setShowManagement((x) => !x)}
            onResearch={() => setShowResearch((x) => !x)}
            onDiplomacy={() => setShowDiplomacy((x) => !x)}
            onExit={onExit}
          />
          {showDiplomacy && <DiplomacyPanel controller={controller} state={s} onClose={() => setShowDiplomacy(false)} />}
          {showResearch && <ResearchPanel controller={controller} state={s} onClose={() => setShowResearch(false)} />}
          {showManagement && <ManagementPanel controller={controller} state={s} onClose={() => setShowManagement(false)} />}
          <VillagerPanel controller={controller} state={s} onFocus={(t) => rendererRef.current?.centerOn(t)} />
          <TilePanel controller={controller} state={s} />
          <ChatLog controller={controller} />
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
      {controller.isNetwork ? (
        <p className="hint">
          多人遊戲：你是 <b style={{ color: s.players[controller.localPlayer].color }}>{s.players[controller.localPlayer].name}</b>
          。{s.players[controller.localPlayer].startTile !== -1 ? '已選好起點，等待其他玩家…' : '每位玩家各自選擇起點。'}
        </p>
      ) : (
      <>
      <div className="row">
        <span>AI 國家數量</span>
        <span className="speeds">
          {Array.from({ length: MAX_AI + 1 }, (_, n) => (
            <button key={n} className={controller.aiCount === n ? 'active' : ''} onClick={() => controller.newGame({ aiCount: n })}>
              {n}
            </button>
          ))}
        </span>
      </div>
      <div className="row">
        <span>地圖大小</span>
        <span className="speeds">
          {Object.entries(BALANCE.mapSizes).map(([key, m]) => (
            <button key={key} className={controller.options.mapSize === key ? 'active' : ''} onClick={() => controller.newGame({ mapSize: key })}>
              {m.name}
            </button>
          ))}
        </span>
      </div>
      <div className="row">
        <span>
          地圖種子 <code>{s.seed}</code>
        </span>
        <button onClick={() => controller.newGame({ seed: randomSeed() })}>🎲 隨機地圖</button>
      </div>
      </>
      )}
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

function totalCapacity(state: GameState, owner: number): number {
  return storesOf(state, owner).reduce((sum, b) => sum + storageCapacity(b), 0);
}

function fmtRate(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}/分`;
}

function TopBar({
  controller,
  state,
  onManagement,
  onResearch,
  onDiplomacy,
  onExit,
}: {
  controller: GameController;
  state: GameState;
  onManagement: () => void;
  onResearch: () => void;
  onDiplomacy: () => void;
  onExit: () => void;
}) {
  const pending = pendingProposals(state, controller.localPlayer);
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
          <span className="res-val" title={`所有城池與倉庫合計，上限 ${totalCapacity(state, me.id)}`}>
            {Math.floor(me.stock[r])}
          </span>
          {(net[r] !== 0 || r === 'food') && (
            <span className={`res-delta ${net[r] < 0 ? 'neg' : 'pos'}`}>{fmtRate(net[r])}</span>
          )}
        </div>
      ))}
      <div className="res">
        <span className="res-name">研究</span>
        <span className="res-val">{Math.floor(me.researchPoints)}</span>
        {researchPerMinute(state, me) > 0 && <span className="res-delta pos">{fmtRate(researchPerMinute(state, me))}</span>}
      </div>
      <button onClick={onManagement}>管理 (M)</button>
      <button onClick={onResearch}>研究 (R)</button>
      <button className={pending ? 'attention' : ''} onClick={onDiplomacy}>
        外交 (D){pending > 0 && ` ●${pending}`}
      </button>
      {me.atWar && <span className="war-tag">⚔ 戰爭中</span>}
      <div className="spacer" />
      <div className="clock">⏱ {formatTime(state.tick)}</div>
      <div className="speeds">
        {SPEEDS.map((sp) => (
          <button key={sp} className={controller.speed === sp ? 'active' : ''} onClick={() => controller.setSpeed(sp)}>
            {SPEED_LABEL[sp]}
          </button>
        ))}
      </div>
      <SoundButton />
      <button
        onClick={() => {
          if (window.confirm(controller.isNetwork ? '確定要離開這場多人遊戲嗎？你的國家會改由 AI 接手。' : '確定要回到主選單嗎？目前的遊戲不會保存。')) onExit();
        }}
      >
        選單
      </button>
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
      <label className="slider">
        新村民出生地
        <select
          value={m.spawnAt ?? ''}
          onChange={(e) => set({ spawnAt: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">主城</option>
          {state.buildings
            .filter((b) => b.owner === me.id && b.progress >= 1 && (b.type === 'camp' || b.type === 'city'))
            .map((b) => (
              <option key={b.id} value={b.id}>
                {BUILDINGS[b.type].name} #{b.id}（糧食 {Math.floor(b.store?.food ?? 0)}）
              </option>
            ))}
        </select>
      </label>
      <div className="hint">出生時的糧食優先從該城池的倉儲扣除。</div>
      <h3>糧食</h3>
      <div>
        收入 {fmtRate(income)}　消耗 {fmtRate(-consumption)}　淨值{' '}
        <b className={income - consumption < 0 ? 'neg' : 'pos'}>{fmtRate(income - consumption)}</b>
      </div>
    </div>
  );
}

function SelectedVillager({ controller, state }: { controller: GameController; state: GameState }) {
  const v = state.villagers.find((x) => x.id === controller.selection.villager && x.owner === controller.localPlayer);
  if (!v) return null;
  const canEnlist = BALANCE.villagerLevels[String(v.level)].canEnlist;
  return (
    <div className="selected-villager">
      <div>
        村民 #{v.id}：LV{v.level}　{v.naval ? '海軍' : v.soldier ? '士兵' : '平民'}　忠誠度 {Math.floor(v.loyalty)}
        {v.resentment >= 1 && <span className="neg">　怨恨 {Math.ceil(v.resentment)}（忠誠上限 {Math.floor(100 - v.resentment)}）</span>}
      </div>
      <div className="actions">
        {v.naval ? null : v.soldier ? (
          <button onClick={() => controller.issue({ type: 'setSoldier', player: v.owner, villager: v.id, soldier: false })}>解除士兵</button>
        ) : (
          <button
            disabled={!canEnlist}
            title={canEnlist ? '' : 'LV1 不能從軍，需先到兵營訓練'}
            onClick={() => controller.issue({ type: 'setSoldier', player: v.owner, villager: v.id, soldier: true })}
          >
            設為士兵
          </button>
        )}
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
      <div className="actions">
        <button
          disabled={!mine.some((v) => v.soldier)}
          onClick={() => {
            const group = mine.filter((v) => v.soldier).map((v) => v.id);
            controller.select({ villager: group[0], group });
          }}
        >
          選取全部士兵
        </button>
        {controller.selection.group.length > 1 && <span className="hint">已選取 {controller.selection.group.length} 人</span>}
      </div>
      {mine.map((v) => (
        <div
          key={v.id}
          className={`villager ${controller.orderTargets.includes(v.id) ? 'selected' : ''} ${v.order.kind === 'idle' ? 'idle' : ''}`}
          onClick={(e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
              const g = new Set(controller.orderTargets);
              if (g.has(v.id)) g.delete(v.id);
              else g.add(v.id);
              const group = [...g];
              controller.select({ villager: group[0] ?? null, group });
            } else controller.select({ villager: v.id });
          }}
          onDoubleClick={() => onFocus(v.tile)}
        >
          <span>
            {v.naval ? '⚓' : v.soldier ? '⚔' : ''}#{v.id} <small>LV{v.level}</small>
            {v.loyalty < 60 && <small className={v.loyalty < 30 ? 'neg' : 'warn'}> 忠誠{Math.floor(v.loyalty)}</small>}
          </span>
          <span className="status">{villagerStatus(state, v)}</span>
        </div>
      ))}
      <SelectedVillager controller={controller} state={state} />
      <div className="hint">
        左鍵：選取 ／ 右鍵：對選取的村民下指令（自己的建築→建造或工作、未探索→探索、有資源→採集、其他→移動）
        <br />
        Shift＋點清單：多選 ／ 士兵右鍵敵方：進攻
        <br />
        空白鍵：暫停 ／ 1 2 3：速度 ／ M：管理 ／ R：研究 ／ D：外交 ／ Enter：訊息
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
        <>
          <div>建造中 {Math.floor(b.progress * 100)}%</div>
          {(b.delivery ?? 0) > 0 && (
            <div className="warn">物資運送中：還要 {Math.ceil((b.delivery ?? 0) / BALANCE.ticksPerSecond)} 秒才會送達工地</div>
          )}
          {def.minVillagersNearby !== undefined && (
            <div className={lacksWorkforce(state, b) ? 'neg' : 'pos'}>
              周圍村民 {villagersNearby(state, b)}/{def.minVillagersNearby}
              {lacksWorkforce(state, b) ? '：人手不足，工程暫停' : '：工程進行中'}
            </div>
          )}
        </>
      ) : (
        <>
          {def.popCap > 0 && <div>人口上限 +{def.popCap}</div>}
          {(b.type === 'city' || b.type === 'camp') && (b.devastation ?? 0) >= 1 && (
            <div className="neg">戰火破壞程度 {Math.round(b.devastation ?? 0)}：被攻佔時，當地居民會帶著同等的怨恨</div>
          )}
          {b.type === 'city' && (
            <div className={independenceChance(state, b) > 0 ? 'neg' : 'hint'}>
              距離首都 {Number.isFinite(distanceToCapital(state, b)) ? distanceToCapital(state, b) : '—'} 格
              {independenceChance(state, b) > 0
                ? `：太遠了！每分鐘有 ${Math.round(independenceChance(state, b) * 100)}% 機率獨立`
                : `（超過 ${independenceThreshold(state)} 格可能獨立）`}
            </div>
          )}
          {def.territoryRadius > 0 && <div>國土半徑 {def.territoryRadius}</div>}
          {def.workerSlots > 0 && (
            <div>
              工作人員 {workers.length}/{def.workerSlots}　每人產量：
              {RESOURCE_TYPES.filter((r) => rates[r] > 0)
                .map((r) => `${RESOURCE_NAMES[r]} ${(rates[r] * 60).toFixed(1)}/分`)
                .join('、') || '無'}
            </div>
          )}
          {def.researchPerWorker !== undefined && (
            <div>
              研究員 {workers.length}/{def.workerSlots}　每人 {(researchRatePerWorker(state, b) * 60).toFixed(1)} 點/分
            </div>
          )}
          {def.trainingSlots > 0 && (
            <div>
              訓練中 {state.villagers.filter((v) => v.order.kind === 'train' && v.order.building === b.id).length}/{def.trainingSlots}　
              每次 {BALANCE.training.seconds} 秒、糧食 {BALANCE.training.foodCost}，升到 LV2
            </div>
          )}
          {def.garrisonSlots > 0 && (
            <div className={garrisonOf(state, b).length === 0 ? 'neg' : 'pos'}>
              駐軍 {garrisonOf(state, b).length}/{def.garrisonSlots}
              {garrisonOf(state, b).length === 0 ? '：沒有駐軍，不提供視野與國土' : '：提供視野與國土'}
            </div>
          )}
          {b.type === 'farm' && hasFreshWaterNearby(state, b.tile) && <div className="pos">鄰近淡水：產量 +{(def.freshWaterBonus ?? 0) * 100}%</div>}
          {b.type === 'mine' && state.tiles[b.tile].terrain !== 'stone' && <div className="neg">不在石地上：產量極低</div>}
          {def.nonForestMultiplier !== undefined && state.tiles[b.tile].terrain !== 'forest' && (
            <div className="neg">不在森林裡：產量 ×{def.nonForestMultiplier}</div>
          )}
          {def.forestAdjacencyBonus !== undefined && adjacentForests(state, b.tile) > 0 && (
            <div className="pos">
              周圍 {adjacentForests(state, b.tile)} 格森林：產量 +{Math.round(def.forestAdjacencyBonus * adjacentForests(state, b.tile) * 100)}%
            </div>
          )}
        </>
      )}
      <StorePanel controller={controller} state={state} b={b} />
      {mine && vid !== null && b.progress >= 1 && def.trainingSlots > 0 && (
        <div className="actions">
          <button onClick={() => controller.issue({ type: 'train', player: controller.localPlayer, villager: vid, building: b.id })}>
            送村民 #{vid} 去訓練
          </button>
        </div>
      )}
      {mine && vid !== null && b.progress >= 1 && (def.navalTrainingSlots ?? 0) > 0 && state.villagers.some((v) => v.id === vid && v.soldier && !v.naval) && (
        <div className="actions">
          <button onClick={() => controller.issue({ type: 'trainNavy', player: controller.localPlayer, villager: vid, building: b.id })}>
            把士兵 #{vid} 訓練為海軍（木材 {BALANCE.naval.navy.cost.wood}、{BALANCE.naval.navy.trainSeconds} 秒）
          </button>
        </div>
      )}
      {mine && vid !== null && b.progress >= 1 && def.garrisonSlots > 0 && (
        <div className="actions">
          <button onClick={() => controller.issue({ type: 'garrison', player: controller.localPlayer, villager: vid, building: b.id })}>
            派士兵 #{vid} 駐守
          </button>
        </div>
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

/** Everyone standing on the tile (that we can see) and what they are doing. */
function UnitsOnTile({ state, me, tile }: { state: GameState; me: number; tile: number }) {
  const player = state.players[me];
  if (!player.visible[tile]) return null;
  const units = state.villagers.filter((v) => v.tile === tile);
  if (units.length === 0) return null;
  return (
    <div className="units-on-tile">
      <div className="hint">這一格的單位：</div>
      {units.slice(0, 8).map((v) => {
        const p = state.players[v.owner];
        return (
          <div key={v.id} className="unit-row">
            <span className="swatch" style={{ background: p.color }} />
            <span>
              {v.owner === me ? '' : `${p.name} `}
              {v.soldier ? '士兵' : '村民'} #{v.id} <small>LV{v.level}</small>
            </span>
            <span className="status">
              {activityIcon(state, v)} {villagerStatus(state, v)}
            </span>
          </div>
        );
      })}
      {units.length > 8 && <div className="hint">……還有 {units.length - 8} 人</div>}
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
      <UnitsOnTile state={state} me={me.id} tile={tile} />
      {villager?.naval && !def.land && (
        <div className="actions">
          <div className="hint">對海軍 #{villager.id} 下令：</div>
          <button onClick={() => controller.issue({ type: 'move', player: me.id, villager: villager.id, tile })}>航行到這裡</button>
          <button className="danger" onClick={() => controller.issue({ type: 'attack', player: me.id, villager: villager.id, tile })}>
            進攻
          </button>
        </div>
      )}
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
          {villager.soldier && (
            <button className="danger" onClick={() => controller.orderTargets.forEach((id) => controller.issue({ type: 'attack', player: me.id, villager: id, tile }))}>
              進攻
            </button>
          )}
          {villager.order.kind !== 'idle' && (
            <button onClick={() => controller.issue({ type: 'stop', player: me.id, villager: villager.id })}>停止</button>
          )}
        </div>
      )}
      {villager && def.land && explored && !hasBuilding && (
        <div className="build-menu">
          <div className="hint">
            建造：<span>（分城 {cityCount(state, me)}/{cityLimit(state, me)}，每 {BALANCE.branchCity.territoryTilesPerCity} 格國土 1 座）</span>
          </div>
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

