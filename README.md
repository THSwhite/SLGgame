# SLG 國戰

即時制的 2D 國戰策略遊戲：探索、經營、國土擴張、外交與戰爭。設計內容見 [`docs/GDD.md`](docs/GDD.md)。

## 開始
```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 模擬核心的自動測試
npm run build
```

## 操作
- 拖曳：平移地圖；滾輪：縮放
- 左鍵：選取地塊或村民（點同一格可切換該格上的村民）
- 右鍵：對選取的村民下指令（自己的建築 → 建造或工作、未探索 → 探索、有資源 → 採集、其他 → 移動）
- 選取村民後點地塊：右側面板可以下令或建造（農田、礦場、民宅）
- `M`：管理選單（人口生產速度、糧食保護）
- 空白鍵：暫停；`1` `2` `3`：1× / 2× / 5× 速度

## 架構
```
src/
  sim/            模擬核心（純 TypeScript，不碰畫面；確定性、固定 tick）
    data/         遊戲數值與地形表（JSON，調整平衡只要改這裡）
    systems/      每個 tick 依序執行的系統（工作、糧食、人口、國土、視野）
    economy.ts    產量、收入、成本計算
    commands.ts   玩家與 AI 的所有操作（之後多人連線時在網路上傳送）
    game.ts       createGame / stepGame
  client/         遊戲控制器（時間、速度、指令佇列）與 PixiJS 地圖繪製
  ui/             React 介面
tests/            Vitest 測試
```

設計原則：
- **模擬核心不能使用 `Math.random()` 和 `Date`**：隨機數一律用 `src/sim/rng.ts`，這樣同樣的種子加上同樣的指令，結果一定相同（多人 lockstep 與重播都靠這一點）。
- **AI 和玩家使用同一套 `Command`**，AI 不會作弊。
