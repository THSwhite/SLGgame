# SLG 國戰

即時制（可暫停、可加速）的 2D 國戰策略遊戲：探索未知的地圖、經營資源、擴張國土，與其他國家建交或開戰。
支援單人對 AI，以及多人連線（最多 4 個國家，玩家加 AI）。

- 遊戲設計與規則的完整說明：[`docs/GDD.md`](docs/GDD.md)
- 給 AI（Claude Code）看的架構說明：[`CLAUDE.md`](CLAUDE.md)

---

## 1. 怎麼執行

需要先安裝 [Node.js](https://nodejs.org/)，版本 22.18 以上（選 LTS 版本）。

```bash
npm install        # 第一次執行前，安裝套件
```

| 想做什麼 | 指令 | 說明 |
|---|---|---|
| 開發、自己測試 | `npm run dev` | 打開 http://localhost:5173 。改了程式或數值，存檔後瀏覽器會自動更新 |
| 開發時測多人 | 另開一個終端機執行 `npm run server` | 多人伺服器在 port 8787。主選單的「伺服器」欄位預設就是這個位址 |
| 正式架站 | `npm run serve` | 先打包，再用同一個伺服器提供網頁和多人連線（port 8787，可以用 `PORT=9000 npm run serve` 修改） |
| 執行自動測試 | `npm test` | 修改規則或數值後，建議跑一次 |
| 檢查型別 | `npm run typecheck` | |

### 多人連線怎麼玩
1. 有一台電腦執行 `npm run serve`（或開發時用 `npm run server`）。
2. 所有玩家用瀏覽器打開那台電腦的網址，例如 `http://192.168.1.10:8787`。
3. 一位玩家按「建立房間」，把 4 位數的**房號**告訴其他人，其他人輸入房號後按「加入」。
4. 房主設定 AI 數量、地圖大小，然後按「開始遊戲」。
5. 遊戲中途有人離線時，他的國家會自動改由 AI 接手。

> 要讓外部網路的朋友連進來，需要把 port 開放到網際網路（路由器的 port forwarding，或部署到雲端主機）。

---

## 2. 操作

| 操作 | 說明 |
|---|---|
| 拖曳 / 滾輪 | 平移地圖 / 縮放 |
| 左鍵 | 選取地塊或村民（點同一格可以切換這格上的不同村民） |
| 右鍵 | 對選取的村民下指令，會自動判斷要做什麼：自己的建築 → 建造或工作（兵營 → 訓練；士兵點瞭望塔 → 駐守）、未探索 → 探索、有資源 → 採集、敵方（戰爭中）→ 進攻、其他 → 移動 |
| 右側面板 | 選取村民後點地塊，可以下指令，也可以建造建築 |
| 左側清單 | Shift＋點擊可以多選；「選取全部士兵」可以一次指揮整支軍隊 |
| `M` | 管理：人口生產速度、糧食保護 |
| `R` | 研究：科技樹與國策 |
| `D` | 外交：建交、斷交、宣戰、停戰（有新提議時按鈕會變紅） |
| 空白鍵 / `1` `2` `3` | 暫停 / 1× 2× 5× 速度 |
| `Enter` | 打開左下角的訊息與事件歷史，輸入文字後按 Enter 送出（多人時所有玩家都看得到）；Esc 或空白時按 Enter 關閉 |

---

## 3. 調整參數（不用改程式）

所有遊戲數值都在 **`src/sim/data/`** 裡的 JSON 檔。改完存檔，`npm run dev` 會自動重新載入。

### 3.1 `balance.json`：整體平衡

| 欄位 | 意思 | 目前的值 |
|---|---|---|
| `ticksPerSecond` | 遊戲每秒計算幾次。**不要改**，改了所有時間都會跟著變 | 10 |
| `map.width` / `map.height` | 預設地圖大小 | 48 × 32 |
| `mapSizes` | 開局可以選的地圖大小（小／中／大），可以新增 | |
| `exploreSeconds` | 探索一塊地需要幾秒 | 5 |
| `moveSecondsPerTile` | 在一般地形上走一格需要幾秒（會再乘以地形的移動耗費） | 1.5 |
| `gatherPerSecond` | 徒手採集速度（每秒） | 糧 1、木 0.8、石 0.6、礦 0.4 |
| `startingVillagers` / `startingStock` | 開局的村民數量 / 資源 | 3 人；糧 100、木 80 |
| `villagerLevels` | 各等級的糧耗（每分鐘）、能否從軍、工作效率 | LV1：6 糧、不可從軍、×1.0；LV2：9 糧、可從軍、×1.3 |
| `warSoldierFoodMultiplier` | 戰時士兵的糧耗倍率（戰爭懲罰） | 1.25 |
| `starvingWorkEfficiency` | 糧食吃完時的工作效率 | 0.5 |
| `population` | 新村民消耗的糧食、生產間隔（預設、最小、最大秒數） | 25 糧；30 秒（10～120） |
| `nonTerritoryBuildingMaxDistance` | 非國土建築最遠可以蓋在國土外幾格 | 2 |
| `training` | 兵營訓練的秒數、糧食、最高等級 | 60 秒、20 糧、LV2 |
| `loyalty` | 忠誠度：下降／恢復速度、叛離門檻與機率、策反距離、忠誠度 0 時的工作效率（`minWorkEfficiency`） | 見檔案；效率最低 50% |
| `diplomacy` | 提議的有效時間、領事館期限、冷卻時間、貿易收入、研究交流加成 | 60 秒、180 秒、300 秒…… |
| `branchCity` | 分城：每幾格國土可以蓋 1 座（`territoryTilesPerCity`）、離首都超過地圖寬度的多少比例開始有獨立風險（`independenceDistanceShare`）、每分鐘的基本／額外獨立機率、獨立時帶走多大範圍內的村民、新國家的初始資源、國家數量上限（`maxNations`，超過就不再建國，分城直接消失） | 30 格、0.5、3%／+12%、半徑 2、10 國 |
| `conquest` | 攻佔主城／分城：區域範圍（國土半徑 + `regionExtraRadius`）、殺死居民／損壞建築（每點生命）／摧毀建築累積的破壞程度、怨恨上限、怨恨每秒消退量、攻下分城時至少拿走的資源比例、攻下非最後一座主城時拿走的資源比例 | 1、8、0.03、10、90、0.05、10%、50% |
| `independentNations` | 分城獨立後成立的新國家的名字與顏色（依序使用） | 6 組 |
| `ai.thinkEverySeconds` | AI 多久做一次決定 | 2 |
| `combat` | 士兵／平民的攻擊力、各等級生命值、恢復速度、地形與駐守的防禦加成、掠奪比例、支援作戰的傷害倍率（`supportDamageMultiplier`）、佔領後建築剩下的生命比例（`captureHpShare`） | 支援 0.5、佔領 0.3，其他見檔案 |
| `victory` | `territorySchedule`：從第幾分鐘起、領土達到多少比例即獲勝（取最新一階）；`timeLimitMinutes`：時間到時領土最多者獲勝 | 20 分 80%、30 分 70%、40 分 60%、50 分 50%；60 分鐘 |
| `naval` | 航運與海軍：海上每格移動耗費（`seaMoveCost`）、解鎖出海的科技（`sailTech`）、解鎖海軍的科技（`navyTech`）、海軍的訓練秒數／成本／攻擊力／生命值 | 0.8、航運、造艦、40 秒／木材 60／8／150 |
| `transport` | 物流：工作地點離最近倉儲每遠 1 格，收入的折減係數（收入 × 1 ÷ (1 + 係數 × 距離)）；建造物資每格的運送秒數；運送村民一次能搬多少 | 0.08、1.5 秒、50 |

### 3.2 `buildings.json`：建築

每種建築的欄位：

| 欄位 | 意思 |
|---|---|
| `name` | 顯示名稱 |
| `buildable` | 玩家能不能建造（營地是 false） |
| `cost` | 成本，例如 `{ "wood": 60, "stone": 10 }` |
| `buildSeconds` | 建造時間（1 位村民、效率 1 的情況） |
| `placement` | `"land"` 任何陸地 ／ `"farmable"` 只能蓋在可耕作地 ／ `"coastal"` 只能蓋在海邊（相鄰有水域的陸地） |
| `forbiddenTerrain` | 不能蓋在哪些地形上，例如伐木場的 `["stone"]` |
| `territory` | `"connected"` 國土建築，範圍必須和現有國土相連 ／ `"near"` 國土內或國土外幾格內 ／ `"foreign"` 蓋在建交對象的國土內（領事館）／ `"free"` 任何不屬於別國的已探索土地，不需要相連（分城）／ `"none"` |
| `maxOutsideDistance` | 只對 `"near"` 有效，覆蓋預設的「國土外幾格」 |
| `territoryRadius` | 提供的國土半徑（0 = 不提供） |
| `visionRadius` | 視野半徑 |
| `popCap` | 增加的人口上限 |
| `workerSlots` / `production` | 工作名額 / 每位工人每秒的產量 |
| `trainingSlots` | 訓練名額（兵營） |
| `garrisonSlots` / `requiresGarrison` | 駐守名額 / 是否要有駐軍才有效果（瞭望塔） |
| `researchPerWorker` | 每位研究員每秒產生的研究點數 |
| `freshWaterBonus` | 鄰近淡水的產量加成（農田 0.5 = +50%） |
| `nonStoneMultiplier` | 蓋在非石地上的產量倍率（礦場 0.1） |
| `nonForestMultiplier` | 不是蓋在森林上的產量倍率（伐木場 0.35） |
| `forestAdjacencyBonus` | 周圍每一格森林增加的產量（伐木場 0.1 = 每格 +10%） |
| `rateModifier` | 由哪個科技／國策效果來加成產量，例如 `"farmRate"`、`"mineRate"`、`"lumberRate"` |
| `hp` | 生命值 |
| `minVillagersNearby` | 建造時，建築所在格和相鄰 6 格內至少要有幾位自己的村民，工程才會推進（分城 3） |
| `storage` | 倉儲容量（每種資源的上限）。主城 600、分城 400、倉庫 500；有這個欄位的建築才能存放資源 |
| `requiresTech` | 需要先研究哪項科技才能建造（港口：`shipping` 航運） |
| `harbor` / `navalTrainingSlots` | 港口：可以從這裡出海／同時訓練幾艘海軍 |
| `capturable` | 戰爭中被打到 0 血時是「佔領」（`true`，建築變成攻擊方的）還是「摧毀」（`false`，例如領事館） |

> **新增一種建築**：只改 JSON 不夠。還需要在 `src/client/renderer.ts` 的 `drawBuilding` 加上它的圖案；如果它有特殊效果，也要寫程式。可以直接請 Claude Code 幫忙。

### 3.3 `terrain.json`：地形
每種地形的名稱、能不能通行（`land`）、是否淡水、移動耗費、可否耕作、顏色，以及可能出現的資源（`deposits`：資源種類、出現機率、數量範圍）。
草地、泥地、沙地都有一定機率出現「野地木材」（零星樹木，採完就沒了），可以調整 `deposits` 裡 `wood` 的 `chance`。

**森林的多寡**由 `src/sim/mapgen.ts` 開頭的 `GROVE_THRESHOLD` 控制（0～1，數字越小，零星小樹林越多；目前是 0.72）。

### 3.4 `tech.json`：科技樹（線性）
科技分成幾條路線（`techBranches.json`：農業、工業、建設、軍事、社會、航海），每項科技有 `branch`（路線）和 `tier`（第幾階），而且必須先研究同一路線的上一階（`requires`）。研究面板會照路線和階層排列。
```json
"agriculture": { "name": "農耕技術", "cost": 40, "requires": [], "description": "農田產量 +25%", "effects": { "farmRate": 0.25 } }
```
- `cost`：研究點數
- `requires`：前置科技的 id
- `effects`：效果，數值會**加**到對應的倍率上（0.25 = +25%，-0.5 = -50%）

### 3.5 `policies.json`：國策
分成幾類，**每類只能選一個**。格式和科技相同，可以新增類別或選項。

### 3.6 科技和國策可以用的效果
這些名稱來自 `src/sim/modifiers.ts`。倍率類預設是 1，加成類預設是 0。

| 效果 | 意思 |
|---|---|
| `farmRate` / `mineRate` / `lumberRate` | 農田 / 礦場 / 伐木場產量 |
| `gatherFood` `gatherWood` `gatherStone` `gatherOre` | 徒手採集速度 |
| `buildSpeed` / `trainSpeed` / `researchRate` | 建造 / 訓練 / 研究速度 |
| `towerRadiusBonus` / `towerVisionBonus` | 瞭望塔國土 / 視野 +N 格 |
| `loyaltyDecay` | 忠誠度下降速度（負數 = 變慢） |
| `popInterval` | 人口生產間隔（負數 = 變快） |
| `foodConsumption` | 糧食消耗 |
| `warFoodPenalty` | 戰爭懲罰的比例（-1 = 取消） |
| `soldierSpeed` / `soldierAttack` / `soldierDefense` | 士兵的速度 / 攻擊 / 防禦 |
| `roughTerrainDefense` | 士兵在森林、泥地的額外防禦 |
| `soldierLoyaltyImmune` | 大於 0 時，士兵的忠誠度不會下降 |
| `subversionResist` | 被策反時抵抗成功的機率 |
| `consulateDeadline` / `tradeIncome` | 領事館期限 / 貿易收入 |
| `plunder` | 掠奪倍率 |
| `navalAttack` / `navalDefense` | 海軍攻擊 / 防禦 |

> 想加入**新的效果名稱**：要在 `modifiers.ts` 加上預設值，並在使用它的地方寫程式。

---

## 4. 音樂與音效

- **背景音樂**放在 `public/audio/music/`，全部是 OpenGameArt.org 的 **CC0（公眾領域）** 作品，可以自由使用，包括商用。來源與作者列在 `public/audio/CREDITS.md`。
  - 平時播放 `peace-*.mp3`，戰爭中自動切換成 `war-*.mp3`，播完會接著播下一首。
  - **換音樂**：把檔案放進 `public/audio/music/`，再修改 `src/client/audio.ts` 開頭的 `PLAYLISTS`。如果使用 CC0 以外的音樂，請確認授權條款，並更新 `CREDITS.md`。
- **音效**（下達指令、錯誤、宣戰、斷交、正式邦交）是用瀏覽器的 Web Audio 即時合成的，沒有音效檔。要調整聲音，修改 `audio.ts` 裡的 `play()`。
- 遊戲中右上角的 🔊 按鈕可以調整音樂和音效音量，或是靜音（設定會記在瀏覽器裡）。
- 瀏覽器規定，使用者點擊頁面之前不能播放聲音，所以音樂會在按下「單人遊戲」或「建立房間／加入」之後才開始。

## 5. 須知與注意事項

1. **改完數值後執行 `npm test`。** 測試會檢查規則有沒有被破壞，例如「非戰時期糧食不會減少」。有些測試直接讀 JSON 裡的值，所以一般調整數值不會讓測試失敗；如果失敗了，通常代表規則真的被改變了。
2. **不要改 `ticksPerSecond`**，除非你想同時改變所有時間的感覺。
3. **多人遊戲時，所有玩家必須用同一個版本**，包括 JSON 數值。數值不同會造成「不同步」，畫面上會出現紅色警告。架站時只要大家都連同一台伺服器的網頁，版本就一定一樣。
4. **地圖種子**：同一個種子一定產生同一張地圖。開局畫面會顯示種子，可以記下喜歡的地圖。
5. **AI 的個性**（好戰度、開放度、擴張度）由地圖種子決定，同一張地圖的 AI 個性也一樣。AI 的行為規則在 `src/sim/ai/ai.ts`。
6. 目前**沒有存檔功能**。離開或重新整理頁面後，遊戲就會消失。

---

## 6. 專案結構（簡要）

```
src/sim/        遊戲規則（模擬核心）── 數值在 src/sim/data/
src/client/     遊戲迴圈、地圖繪製、多人連線用戶端、音樂與音效（audio.ts）
public/audio/   背景音樂與授權說明（CREDITS.md）
src/ui/         介面（React）
src/net/        多人連線的訊息格式
server/         多人連線伺服器
tests/          自動測試
docs/GDD.md     遊戲設計文件
```

更詳細的架構與開發規則請看 [`CLAUDE.md`](CLAUDE.md)。
