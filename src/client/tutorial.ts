import { BUILDINGS, TERRAIN, type ResourceType } from '../sim/data';
import { colOf, hexDistance, rowOf, tilesInRadius } from '../sim/hex';
import { findPath } from '../sim/pathfinding';
import { capitalOf, fillStore } from '../sim/storage';
import { getRelation } from '../sim/systems/diplomacy';
import { createGame, stepGame } from '../sim/game';
import type { GameState } from '../sim/types';
import { GameController } from './controller';

/** Fixed tutorial map: same seed, size and starts every time. */
export const TUTORIAL_SEED = 777;
export const TUTORIAL_MAP = 'small';
const PLAYER = 0;
const NEIGHBOUR = 1;

export interface TutorialStep {
  title: string;
  /** Lines of instructions (zh-Hant). */
  text: string[];
  /** Resources added to our capital when the step starts. */
  grant?: Partial<Record<ResourceType, number>>;
  /** Called once when the step starts; remembers a baseline for `done`. */
  begin?: (t: Tutorial) => void;
  done: (t: Tutorial) => boolean;
  /** Where "帶我看" points the camera. */
  focus?: (t: Tutorial) => number | null;
}

function solidStart(s: GameState, i: number): boolean {
  const ring = tilesInRadius(s, i, 2);
  return ring.length === 19 && ring.every((t) => TERRAIN[s.tiles[t].terrain].land) &&
    ring.filter((t) => TERRAIN[s.tiles[t].terrain].farmable).length >= 6 &&
    tilesInRadius(s, i, 3).some((t) => s.tiles[t].terrain === 'forest');
}

/** Deterministic starts: ours near the centre, the neighbour 11–13 tiles away by land. */
function chooseStarts(s: GameState): [number, number] {
  const cx = s.width / 2;
  const cy = s.height / 2;
  const candidates = s.tiles
    .map((_, i) => i)
    .filter((i) => solidStart(s, i))
    .sort((a, b) => Math.abs(colOf(s, a) - cx) + Math.abs(rowOf(s, a) - cy) - (Math.abs(colOf(s, b) - cx) + Math.abs(rowOf(s, b) - cy)) || a - b);
  for (const me of candidates) {
    const other = s.tiles
      .map((_, i) => i)
      .find((i) => solidStart(s, i) && hexDistance(s, i, me) >= 11 && hexDistance(s, i, me) <= 13 && findPath(s, me, i) !== null);
    if (other !== undefined) return [me, other];
  }
  throw new Error('tutorial map has no valid starts');
}

function direction(s: GameState, from: number, to: number): string {
  const dx = colOf(s, to) - colOf(s, from);
  const dy = rowOf(s, to) - rowOf(s, from);
  const ns = dy < -2 ? '北' : dy > 2 ? '南' : '';
  const ew = dx < -2 ? '西' : dx > 2 ? '東' : '';
  return ns && ew ? `${ew}${ns}方` : `${ns || ew}方`;
}

export class Tutorial {
  index = 0;
  /** Per-step baseline numbers (explored tiles, owned land...). */
  baseline = 0;
  completedAt: number | null = null;
  readonly steps: TutorialStep[];
  readonly neighbourTile: number;

  constructor(readonly controller: GameController) {
    const s = controller.state;
    this.neighbourTile = s.players[NEIGHBOUR].startTile;
    const dir = direction(s, s.players[PLAYER].startTile, this.neighbourTile);
    const mine = () => controller.state.villagers.filter((v) => v.owner === PLAYER);
    const myBuildings = (type: string, complete = true) =>
      controller.state.buildings.filter((b) => b.owner === PLAYER && b.type === type && (!complete || b.progress >= 1));
    const nearestDeposit = () => {
      const st = controller.state;
      const start = st.players[PLAYER].startTile;
      return (
        st.tiles
          .map((_, i) => i)
          .filter((i) => st.players[PLAYER].knowledge[i] === 1 && st.tiles[i].deposits.some((d) => d.resource === 'wood'))
          .sort((a, b) => hexDistance(st, a, start) - hexDistance(st, b, start) || a - b)[0] ?? start
      );
    };
    const rel = () => getRelation(controller.state, PLAYER, NEIGHBOUR);

    this.steps = [
      {
        title: '如何採集',
        text: [
          '畫面左邊是你的村民清單。點一位村民選取他。',
          '地圖上有小圖示的地塊代表有資源：三角形是木材，圓點是糧食，方塊是石材。',
          '選取村民後，用滑鼠右鍵點有資源的地塊，他就會去採集。資源會送進最近的主城或倉庫。',
        ],
        done: () => mine().some((v) => v.order.kind === 'gather'),
        focus: nearestDeposit,
      },
      {
        title: '村民控制',
        text: [
          '右鍵點空地可以讓村民移動；按「下一位閒置」可以快速找到沒事做的村民。',
          '在清單上按住 Shift 再點，可以一次選取多位村民，再一起下指令。',
          '請選一位村民，右鍵點一塊空地，讓他移動過去。',
        ],
        done: () => mine().some((v) => v.order.kind === 'move'),
      },
      {
        title: '建造建築',
        text: [
          '已補給木材。選一位村民，再左鍵點自己國土（紅框內）的一塊草地或泥地。',
          '右側面板的「建造」區塊列出能蓋的建築，按「農田」。',
          '村民會先等物資運到工地，再開始建造。蓋好後他會留下來耕作，提供糧食。',
        ],
        grant: { wood: 120 },
        done: () => myBuildings('farm').length > 0,
      },
      {
        title: '發展科技',
        text: [
          '已補給木材。用同樣方式蓋一座「研究所」，並派村民進去工作（右鍵點研究所），他們會產生研究點數。',
          '按 R 打開研究面板。科技樹分成好幾條路線，每條要由上而下依序研究。',
          '點一項可以研究的科技（金框）開始研究，例如「農耕技術」。',
        ],
        grant: { wood: 120 },
        done: () => myBuildings('research', false).length > 0 && (controller.state.players[PLAYER].currentResearch !== null || controller.state.players[PLAYER].researched.length > 0),
      },
      {
        title: '拓展國土',
        text: [
          '已補給木材。「民宅」是國土建築：蓋好後，周圍的土地會變成你的國土，也會增加人口上限。',
          '把民宅蓋在國土的邊緣，國土就會往外擴張。新的國土會自動探索，顯示地形和資源。',
        ],
        grant: { wood: 120 },
        begin: (t) => {
          t.baseline = controller.state.tiles.filter((x) => x.owner === PLAYER).length;
        },
        done: (t) => controller.state.tiles.filter((x) => x.owner === PLAYER).length > t.baseline,
      },
      {
        title: '探索未知地',
        text: [
          '灰色的陸地是還沒探索過的地方，看不到上面有什麼資源。',
          '不需要先選村民：直接用右鍵點一塊灰色陸地，系統會派最近的閒置單位去探索。',
          '（也可以左鍵點選地塊，再按右側的「探索」。）',
        ],
        begin: (t) => {
          t.baseline = controller.state.players[PLAYER].knowledge.filter((k) => k === 1).length;
        },
        done: (t) =>
          controller.state.villagers.some((v) => v.owner === PLAYER && v.order.kind === 'explore') ||
          controller.state.players[PLAYER].knowledge.filter((k) => k === 1).length > t.baseline + 2,
      },
      {
        title: '遇到他國',
        text: [
          `聽說${dir}有一個國家。派村民往${dir}一路探索或移動，直到看見對方的國土或村民。`,
          '看到其他國家的單位、建築或國土時，就算「接觸」了。之後才能進行外交。',
        ],
        done: () => rel().contact,
        focus: () => this.neighbourTile,
      },
      {
        title: '如何外交',
        text: [
          '按 D 打開外交面板，對鄰國按「提議建交」。',
          '建交後雙方要在期限內，到對方國土內各蓋一座領事館，才能成為正式邦交（共享地圖、貿易、研究加成）。',
          '這次教學中，鄰國會接受你的提議。',
        ],
        done: () => {
          const r = rel();
          if (r.proposal?.from === PLAYER) {
            // The tutorial neighbour always agrees.
            controller.issue({ type: 'diplomacy', player: NEIGHBOUR, target: PLAYER, action: 'accept' });
          }
          return r.status === 'establishing' || r.status === 'allied';
        },
      },
      {
        title: '訓練士兵',
        text: [
          '已補給資源。蓋一座「兵營」，再右鍵點兵營把村民送去訓練，60 秒後升到 LV2（可以按 2 或 3 加速遊戲）。',
          'LV2 村民在左側面板可以按「設為士兵」。請準備至少 2 名士兵。',
        ],
        grant: { wood: 150, stone: 60, food: 200 },
        done: () => mine().filter((v) => v.soldier).length >= 2,
      },
      {
        title: '如何宣戰',
        text: [
          '不能直接攻擊其他國家，必須先宣戰。',
          '按 D 打開外交面板，對鄰國按「宣戰」（會詢問是否確定）。宣戰後邦交與領事館都會取消。',
        ],
        done: () => rel().status === 'war',
      },
      {
        title: '戰勝敵國',
        text: [
          '在左側清單按「選取全部士兵」，再右鍵點鄰國的主城（戴王冠的建築），士兵就會進攻。',
          '攻下對方最後一座主城，就能吞併整個國家，贏得勝利！',
        ],
        begin: () => {
          // Keep the tutorial war short.
          const camp = capitalOf(controller.state, NEIGHBOUR);
          if (camp) camp.hp = Math.min(camp.hp, BUILDINGS.camp.hp / 3);
        },
        done: () => controller.state.players[NEIGHBOUR].eliminated || controller.state.result?.winner === PLAYER,
        focus: () => capitalOf(controller.state, NEIGHBOUR)?.tile ?? this.neighbourTile,
      },
    ];
    this.startStep();
  }

  get step(): TutorialStep | null {
    return this.steps[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= this.steps.length;
  }

  private startStep() {
    const step = this.step;
    if (!step) return;
    if (step.grant) {
      const capital = capitalOf(this.controller.state, PLAYER);
      if (capital) fillStore(this.controller.state, capital, step.grant);
    }
    step.begin?.(this);
  }

  /** Check progress; called a few times per second by the UI. */
  update(): void {
    const step = this.step;
    if (!step) return;
    if (this.completedAt === null && step.done(this)) this.completedAt = this.controller.state.tick;
    // Short pause on "完成！" before moving on.
    if (this.completedAt !== null && this.controller.state.tick - this.completedAt >= 15) this.next();
    if (this.completedAt !== null && this.controller.speed === 0) this.next();
  }

  next(): void {
    this.index++;
    this.completedAt = null;
    this.startStep();
    this.controller.notify();
  }
}

/** A single-player game on the fixed tutorial map, already started. */
export function createTutorialController(): GameController {
  const c = new GameController({ seed: TUTORIAL_SEED, aiCount: 1, mapSize: TUTORIAL_MAP });
  c.state = createGame({
    seed: TUTORIAL_SEED,
    mapSize: TUTORIAL_MAP,
    players: [
      { name: '我的國家', color: '#e53935', isAI: false },
      { name: '鄰國', color: '#1e88e5', isAI: true },
    ],
  });
  const [mine, theirs] = chooseStarts(c.state);
  stepGame(c.state, [
    { type: 'chooseStart', player: NEIGHBOUR, tile: theirs },
    { type: 'chooseStart', player: PLAYER, tile: mine },
  ]);
  // The tutorial neighbour stays passive: it only does what the tutorial asks.
  c.state.players[NEIGHBOUR].ai = null;
  c.state.players[NEIGHBOUR].management.popEnabled = false;
  c.tutorial = new Tutorial(c);
  return c;
}
